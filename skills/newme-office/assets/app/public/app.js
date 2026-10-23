import { Office } from "./office.js";
document.documentElement.dataset.studio ||= "architectural";
import { OfficeSound } from "./sound.js";
import { SOUND_CHOICES } from "./sound-catalog.js";
import { createOfficeControls } from "./controls.js";
import { createSlapControls } from "./slap.js";
import { oneWorkerPerTask } from "./worker-seats.js";
import { createConnectionGuide } from "./connection-guide.js";
import { createWorkSelection } from "./work-selection.js";
import { assignRoles, DEFAULT_ROLES } from "./roles.mjs";
import {
  LANGUAGES,
  setLocale,
  getLocale,
  detectLocale,
  t,
  roleName,
} from "./i18n.js";
import { projectKey, projectName } from "./projects.js";
import { createDeliveryTray } from "./delivery.js";
import { createFocusView } from "./focus.js";
const $ = (selector) => document.querySelector(selector),
  order = { working: 0, waiting: 1, error: 2, unknown: 3, idle: 4, done: 5 };
let prefs;
try {
  prefs = JSON.parse(localStorage.getItem("workroom.preferences.v1")) || {};
} catch {
  prefs = {};
}
const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
  darkSystem = matchMedia("(prefers-color-scheme: dark)");
const settings = {
  sound: prefs.sound === true,
  motion: prefs.motion ?? !reduced.matches,
  walking: prefs.walking !== false,
  officeSounds: prefs.officeSounds === true,
  studioShowEmpty: prefs.studioShowEmpty === true,
  sceneStyle: prefs.sceneStyle === "pixel" ? "pixel" : "modern",
  bossVisible: prefs.bossVisible !== false,
  moreSettingsOpen: prefs.moreSettingsOpen !== false,
  volume: Math.min(
    1,
    Math.max(0, Number.isFinite(prefs.volume) ? prefs.volume : 0.25),
  ),
  locale:
    prefs.locale || "zh",
  theme: ["system", "graphite", "dark", "light"].includes(prefs.theme)
    ? prefs.theme
    : "light",
  roles: Array.isArray(prefs.roles)
    ? prefs.roles.filter(
        (r) =>
          r &&
          typeof r.id === "string" &&
          typeof r.name === "string" &&
          /^#[a-f0-9]{6}$/i.test(r.color) &&
          Array.isArray(r.keywords),
      )
    : [],
  overrides:
    prefs.overrides && typeof prefs.overrides === "object"
      ? prefs.overrides
      : {},
};
setLocale(settings.locale);
let state = { tasks: [], roles: DEFAULT_ROLES, health: {} },
  tasks = [],
  roles = DEFAULT_ROLES,
  selected = null,
  selectedRole = "",
  filterStatus = "working",
  demo = false,
  liveState = null,
  previous = new Map(),
  connected = false,
  initial = true,
  source;
let lastLiveEventAt = 0, liveSnapshotRequest = null;
const publicDemo = document.documentElement.dataset.mode === "demo";
let displayIdentity = "";
const workPicker = createWorkSelection({
  button: $("#work-picker-open"),
  getTasks: () => tasks,
  t,
  onChange: (selection) => {
    const identity = JSON.stringify([selection.mode, selection.taskKeys]);
    if (identity !== displayIdentity) selectedRole = "";
    displayIdentity = identity;
    if (
      selected &&
      !workPicker.matches(tasks.find((task) => task.id === selected))
    )
      selected = null;
    filterStatus = selection.status;
    $("#status-filter").value = filterStatus;
    applyState.lastKey = null;
    applyState(state);
  },
  onError: toast,
});
const soundscape = new OfficeSound();
const office = new Office({
  style: settings.sceneStyle,
  bossVisible: settings.bossVisible,
  canvas: $("#office-canvas"),
  overlay: $("#seat-overlay"),
  world: $("#office-world"),
  viewport: $("#office-viewport"),
  onSelect: selectTask,
  onActivity: (event) => soundscape.officeEvent(event),
});
function refreshBadges() {
  const badges = [
    { canvas: $(".clock-mascot"), variant: 0 },
    ...["working", "waiting", "done"].map((status, variant) => ({
      canvas: $(".pulse-character." + status),
      variant,
    })),
  ];
  const empty = $(".empty-portrait");
  if (empty) badges.push({ canvas: empty, variant: 0 });
  office.setBadges?.(badges);
}
refreshBadges();
const focusView = createFocusView({
  panel: $(".office-panel"),
  viewport: $("#office-viewport"),
  button: $("#focus-toggle"),
  usagePanel: null,
  t,
});
const delivery = createDeliveryTray({
  panel: $(".office-panel"),
  getMotion: () => settings.motion,
  t,
  getSeats: () => office.seats,
  includeEntry: (entry) =>
    workPicker.matches({ id: entry.taskId, source: entry.source }),
  getReply: async (entry, { signal }) => {
    if (entry.scope === "demo" && entry.taskId.startsWith("demo-"))
      return {
        status: "available",
        taskId: entry.taskId,
        turnId: entry.turnId,
        text: t("demoReplyText", { task: entry.title }),
        truncated: false,
        fictional: true,
      };
    
    if (!entry.turnId) return { status: "unavailable" };
    const query = new URLSearchParams({
      taskId: entry.taskId,
      turnId: entry.turnId,
    });
    const response = await fetch(`/api/reply?${query}`, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw Error("Reply unavailable");
    return response.json();
  },
  onOpenTask: async (id) => {
    await focusView.exit();
    selectTask(id);
  },
});
const controls = createOfficeControls({
  t,
  getView: () => ({ tasks, selected, demo, control: state.control }),
  onSubmitted: async (result) => { selectedRole=''; selected=result.taskId; await refreshLiveSnapshot(); },
});
const connectionGuide = createConnectionGuide({
  t,
  getLocale,
  getContext: () => ({
    demo,
    local: state.health,
    cloud: state.cloud,
    port: location.port,
  }),
});
const slapControls = createSlapControls({
  getView: () => ({tasks,selected,demo}),
  onDraft: (task,text) => controls.draftFeedback(task,text),
  onSlap: () => { if(settings.motion) office.bossAction('whip'); },
});
function persist() {
  try {
    localStorage.setItem("workroom.preferences.v1", JSON.stringify(settings));
  } catch {
    toast(t("saveFailed"));
  }
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function audioReady() {
  return soundscape.unlock();
}
function sound(kind) {
  return soundscape.notify(kind);
}
function syncAudio() {
  soundscape.configure({
    enabled: settings.sound,
    volume: settings.volume,
    office: settings.officeSounds,
    motion: settings.motion,
    scene: !$("#office-viewport").hidden,
    working: filteredTasks().some((task) => task.status === "working"),
  });
}
function settingsUI() {
  $("#sound-toggle").textContent =
    `♪ ${t("sound")} ${t(settings.sound ? "on" : "off")}`;
  $("#sound-toggle").setAttribute("aria-pressed", settings.sound);
  $("#motion-toggle").textContent =
    `${t("motion")} ${t(settings.motion ? "on" : "off")}`;
  $("#motion-toggle").setAttribute("aria-pressed", settings.motion);
  $("#sound-setting").checked = settings.sound;
  $("#office-sounds-setting").checked = settings.officeSounds;
  $("#motion-setting").checked = settings.motion;
  $("#volume-setting").value = Math.round(settings.volume * 100);
  if ($("#walking-setting")) $("#walking-setting").checked = settings.walking;
  office.setMotion(settings.motion);
  office.setWandering?.(settings.walking);
  delivery.refreshMotion();
  $("#theme-setting").value = settings.theme;
  const theme =
    settings.theme === "system"
      ? darkSystem.matches
        ? "graphite"
        : "light"
      : settings.theme;
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").textContent = theme === "light" ? "☾" : "☀";
  office.setTheme(theme);
  refreshStudioIcons();
  syncAudio();
}
async function setSound(value) {
  settings.sound = value;
  persist();
  settingsUI();
  if (value && (await audioReady()) && settings.sound) void sound("enabled");
}
function setMotion(value) {
  settings.motion = value;
  persist();
  settingsUI();
}
function setTheme(value) {
  settings.theme = value;
  persist();
  settingsUI();
}
function language(value) {
  setLocale(value);
  settings.locale = getLocale();
  persist();
  localize();
  applyState.lastKey = null;
  applyState(state);
}
function text(selector, key) {
  const node = $(selector);
  if (node) node.textContent = t(key);
}
function attr(selector, name, key) {
  const node = $(selector);
  if (node) node.setAttribute(name, t(key));
}
function labelText(selector, key) {
  const node = $(selector);
  if (!node) return;
  const element = node.querySelector("input,select");
  node.replaceChildren(document.createTextNode(t(key)));
  if (element) node.append(element);
}
function localize() {
  const lang = LANGUAGES.find((l) => l.code === getLocale());
  document.documentElement.lang = getLocale();
  document.documentElement.dir = lang?.dir || "ltr";
  document.title = "newme office";
  for (const selector of ["#language-quick", "#language-setting"]) {
    const node = $(selector);
    node.replaceChildren(...LANGUAGES.map((l) => new Option(l.name, l.code)));
    node.value = getLocale();
    node.setAttribute("aria-label", t("langLabel"));
  }
  text("h1", "officeHeading");
  text("#credit-footnote", "creditSmall");
  attr("#credit-footnote", "title", "creditHelp");
  text("#download-app", "downloadApp");
  attr("#project-help-open", "aria-label", "projectInfo");
  text("#project-info-title", "projectHelpTitle");
  text("#project-info-text", "projectHelp");
  text("#demo-step", "demoStep");
  delivery.refreshText();
  focusView.refreshText();
  attr("#project-info-dialog .icon-button", "aria-label", "close");
  text("#office-view", "officeView");
  text("#list-view", "listView");
  attr("#settings-open", "aria-label", "settings");
  attr("#theme-toggle", "aria-label", "themeLabel");
  attr("#status-filter", "aria-label", "allStatuses");
  attr(".toolbar", "aria-label", "allStatuses");
  attr(".office-panel", "aria-label", "officeView");
  attr("#office-canvas", "aria-label", "officeView");
  $(".brand").setAttribute("aria-label", "newme office");
  $("#status-filter").previousElementSibling.textContent = t("allStatuses");
  const names = {
    working: "activeOnly",
    "": "allStatuses",
    waiting: "waiting",
    done: "done",
    idle: "idle",
    error: "error",
    unknown: "unknown",
  };
  for (const option of $("#status-filter").options)
    option.text = t(names[option.value]);
  attr("#zoom-in", "aria-label", "zoomIn");
  attr("#zoom-out", "aria-label", "zoomOut");
  text("#zoom-fit", "fit");
  text(".overview h2", "nowHere");
  text(".teams-section h2", "teams");
  text("#add-role", "addRole");
  for (const button of document.querySelectorAll("[data-filter]")) {
    const span = button.querySelector("span:not(.pulse-character)"),
      dot = span.querySelector("i");
    span.replaceChildren(
      dot,
      document.createTextNode(t(button.dataset.filter)),
    );
  }
  for (const legend of document.querySelectorAll(".legend>span")) {
    const dot = legend.querySelector("i");
    legend.replaceChildren(dot, document.createTextNode(t(dot.className)));
  }
  text("#active-help", "activeHelp");
  text("#settings-dialog h2", "settingsTitle");
  attr("#settings-dialog .icon-button", "aria-label", "close");
  text("#lang-label", "langLabel");
  text("#theme-label", "themeLabel");
  text("#language-note", "contentNotTranslated");
  for (const option of $("#theme-setting").options)
    option.text = t(
      {
        system: "themeSystem",
        light: "themeLight",
        dark: "themeDark",
        graphite: "themeGraphite",
      }[option.value],
    );
  const soundRow = $("#sound-setting").closest(".setting-row");
  soundRow.querySelector("strong").textContent = t("sound");
  soundRow.querySelector("p").textContent = t("soundHelp");
  attr("#sound-setting", "aria-label", "sound");
  $("#volume-setting").previousElementSibling.textContent = t("volume");
  attr("#volume-setting", "aria-label", "volume");
  text("#test-sound", "testSound");
  text("#office-sounds-label", "officeSounds");
  text("#office-sounds-help", "officeSoundsHelp");
  attr("#office-sounds-setting", "aria-label", "officeSounds");
  attr("#sound-preview", "aria-label", "soundPreview");
  const preview = $("#sound-preview"),
    chosenSound = preview.value || "success";
  preview.replaceChildren(
    ...SOUND_CHOICES.map((key) => new Option(t(`sound.${key}`), key)),
  );
  preview.value = chosenSound;
  const motionRow = $("#motion-setting").closest(".setting-row");
  motionRow.querySelector("strong").textContent = t("motion");
  motionRow.querySelector("p").textContent = t("motionHelp");
  attr("#motion-setting", "aria-label", "motion");
  text("#walking-label", "walking");
  text("#walking-help", "walkingHelp");
  text("#walking-note", "walkingDefault");
  text("#effects-note", "effectsHelp");
  attr("#walking-setting", "aria-label", "walking");
  text("#cloud-heading", "cloudConnection");
  text("#cloud-help", "cloudHelp");
  text("#cloud-limit", "cloudLimit");
  text("#pair-show", "pairShow");
  text("#pair-copy", "pairCopy");
  attr("#pair-token", "aria-label", "pairCode");
  text(".settings-content>p:last-child", "settingsLocal");
  text("#role-dialog h2", "roleTitle");
  attr("#role-close", "aria-label", "close");
  labelText("#role-form>label:nth-of-type(1)", "roleName");
  labelText("#role-form>label:nth-of-type(2)", "roleColor");
  labelText("#role-form>label:nth-of-type(3)", "roleKeywords");
  attr("#role-name", "placeholder", "roleNamePlaceholder");
  attr("#role-keywords", "placeholder", "roleKeywordsPlaceholder");
  text("#role-form .settings-help", "roleHelp");
  text("#role-form .primary-button", "roleCreate");
  controls.refreshText();
  workPicker.refreshText();
  connectionGuide.refreshText();
  text("#connection-guide-open", "connectionGuide");
  attr("#connection", "aria-label", "connectionGuide");
  attr("#connection", "title", "connectionGuide");
  settingsUI();
}
function roleList() {
  return [
    ...(state.roles || DEFAULT_ROLES),
    ...settings.roles.filter(
      (r) => !(state.roles || DEFAULT_ROLES).some((x) => x.id === r.id),
    ),
  ];
}
function applyState(next) {
  const completed = delivery.observe(
    (next.tasks || []).filter(workPicker.matches),
    {
      scope: demo ? "demo" : "live",
    },
  );
  state = next;
  roles = roleList();
  tasks = (next.tasks || [])
    .map((task) => {
      const assignments = assignRoles(task, roles, settings.overrides);
      return {
        ...task,
        assignments,
        roleId: assignments[0]?.roleId,
        reason: assignments[0]?.reason,
      };
    })
    .sort(
      (a, b) =>
        (order[a.status] ?? 5) - (order[b.status] ?? 5) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
  if (!initial) {
    const changes = tasks.filter(
        (task) =>
          workPicker.matches(task) &&
          previous.has(task.id) &&
          previous.get(task.id) !== task.status,
      ),
      notice =
        changes.find((task) => task.status === "error") ||
        changes.find((task) => task.status === "waiting") ||
        changes.find((task) => task.status === "working");
    if (completed.length) void sound("done");
    else if (notice) void sound(notice.status);
  }
  previous = new Map(tasks.map((task) => [task.id, task.status]));
  initial = false;
  workPicker.refreshTasks();
  const key = JSON.stringify(
    tasks.map((task) => [
      task.id,
      task.title,
      projectKey(task),
      projectName(task),
      task.assignments,
      task.status,
    ]),
  );
  if (key !== applyState.lastKey) {
    applyState.lastKey = key;
    render();
  } else renderDetails();
  renderHealth();
}
function filteredTasks() {
  return tasks.filter(
    (task) =>
      workPicker.matches(task) &&
      (!filterStatus || task.status === filterStatus) &&
      (!selectedRole ||
        task.assignments.some((a) => a.roleId === selectedRole)),
  );
}
function render() {
  const visible = filteredTasks(),
    seats = oneWorkerPerTask(visible.flatMap((task) =>
      task.assignments
        .filter((a) => !selectedRole || a.roleId === selectedRole)
        .map((assignment) => ({
          ...task,
          ...assignment,
          id: `${task.id}:${assignment.roleId}`,
          taskId: task.id,
        })),
    )),
    visibleRoles = selectedRole
      ? roles.filter((role) => role.id === selectedRole)
      : settings.studioShowEmpty ? roles : roles.filter((role) =>
          seats.some((seat) => seat.roleId === role.id));
  if (!visible.some(task => task.id === selected)) selected = visible[0]?.id || null;
  office.setData(seats, visibleRoles, selected);
  $("#seat-count").textContent = t("seatSummary", {
    tasks: visible.length,
    seats: seats.length,
    teams: visibleRoles.length,
  });
  $("#floor-label").textContent = workPicker.caption();
  for (const status of ["working", "waiting", "done"]) {
    const count = tasks.filter(
      (task) => workPicker.matches(task) && task.status === status,
    ).length;
    const number = $(`#${status}-count`);
    number.textContent =
      !connected && !demo ? "—" : count >= 1000
        ? new Intl.NumberFormat(getLocale(), {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(count)
        : String(count);
    number.title = String(count);
    number.setAttribute("aria-label", String(count));
    number.closest("button").dataset.wide = String(count >= 100);
  }
  const teamRoot = $("#teams");
  teamRoot.replaceChildren();
  for (const role of roles) {
    const teamTasks = tasks.filter(
        (task) =>
          task.assignments.some((a) => a.roleId === role.id) &&
          workPicker.matches(task) &&
          (!filterStatus || task.status === filterStatus),
      ),
      button = document.createElement("button");
    button.className = `team-row${selectedRole === role.id ? " active" : ""}`;
    button.classList.toggle("studio-empty-team", teamTasks.length === 0);
    button.setAttribute("aria-pressed", selectedRole === role.id);
    const icon = document.createElement("span");
    icon.className = "team-icon";
    icon.style.setProperty("--team-color", role.color);
    icon.textContent = roleName(role)[0];
    const label = document.createElement("span");
    label.textContent = roleName(role);
    const count = document.createElement("span");
    count.className = "team-count";
    count.textContent = teamTasks.length;
    button.append(icon, label, count);
    if (teamTasks.some((task) => task.status === "working")) {
      const dot = document.createElement("span");
      dot.className = "team-running";
      button.append(dot);
    }
    button.onclick = () => {
      selectedRole = selectedRole === role.id ? "" : role.id;
      render();
    };
    teamRoot.append(button);
  }
  renderTable(visible);
  renderDetails();
  renderStudio();
  syncAudio();
}
function renderStudio() {
  const zh = getLocale() === "zh";
  document.documentElement.classList.toggle("studio-show-empty", settings.studioShowEmpty);
  const roomsButton = $("#studio-rooms");
  roomsButton.setAttribute("aria-pressed", String(settings.studioShowEmpty));
  roomsButton.textContent = zh ? (settings.studioShowEmpty ? "收起空闲团队" : "展开空闲团队") : (settings.studioShowEmpty ? "Hide empty teams" : "Show empty teams");
  const scoped = tasks.filter(workPicker.matches);
  const needsYou = scoped.filter((task) => ["waiting", "error"].includes(task.status));
  const running = scoped.filter((task) => task.status === "working");
  $("#studio-scope").textContent = !connected && !demo ? (zh ? "正在读取本机任务 · 迪拜时间" : "Syncing local tasks · Dubai time") : zh ? `${running.length} 进行中 · ${needsYou.length} 待处理` : `${running.length} active · ${needsYou.length} need you · Dubai time`;
  const queue = [...needsYou, ...running];
  $("#studio-now-title").textContent = !connected && !demo ? (zh ? "正在同步" : "Syncing") : needsYou.length ? (zh ? "需要你处理" : "Needs you") : (zh ? "正在推进" : "In progress");
  $("#studio-live-count").textContent = !connected && !demo ? "—" : zh ? `${queue.length} 项` : `${queue.length} tasks`;
  const list = $("#studio-now-list");
  const queueKey = JSON.stringify([getLocale(), connected, queue.map((task) => [task.id, task.title, task.status, task.assignments])]);
  if (list.dataset.render !== queueKey) {
    list.dataset.render = queueKey;
    list.replaceChildren();
    for (const task of queue.slice(0, 5)) {
      const button = document.createElement("button");
      button.className = "studio-task";
      button.dataset.status = task.status;
      button.dataset.taskId = task.id;
      button.title = task.title;
      const title = document.createElement("span");
      title.className = "studio-task-title";
      title.textContent = task.title;
      const meta = document.createElement("span");
      meta.className = "studio-task-meta";
      meta.textContent = `${t(task.status)} · ${task.assignments.map((a) => roleName(roles.find((r) => r.id === a.roleId))).join(" / ")}`;
      button.append(title, meta);
      button.onclick = () => {
        selectTask(task.id);
        $("#task-details").scrollIntoView({behavior: settings.motion ? "smooth" : "auto", block: "nearest"});
      };
      list.append(button);
    }
    if (!queue.length) {
      const empty = document.createElement("p");
      empty.className = "studio-empty";
      empty.textContent = !connected && !demo ? (zh ? "正在读取本机任务，状态尚未确认。" : "Reading local tasks. Status not confirmed yet.") : zh ? "此刻没有进行中或等待确认的任务。" : "No active tasks right now. Your team returns when work starts.";
      list.append(empty);
    }
  }
  for (const button of list.querySelectorAll(".studio-task")) button.classList.toggle("selected", button.dataset.taskId === selected);
  $("#studio-all-tasks").textContent = zh ? `查看完整任务列表（${scoped.length}）` : `View all tasks (${scoped.length})`;
}
function makeStatus(status) {
  const node = document.createElement("span");
  node.className = "job-status";
  const dot = document.createElement("i");
  dot.className = status;
  node.append(
    dot,
    document.createTextNode(t(status in order ? status : "unknown")),
  );
  return node;
}
function renderTable(visible) {
  const root = $("#jobs-table");
  root.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-office";
    const h = document.createElement("h3");
    h.textContent = t("noTasks");
    const p = document.createElement("p");
    p.textContent = t("noTasksHelp");
    empty.append(h, p);
    root.append(empty);
    return;
  }
  const table = document.createElement("table"),
    head = document.createElement("thead"),
    row = document.createElement("tr");
  for (const key of ["jobTitle", "roleLabel", "allStatuses"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = t(key);
    row.append(cell);
  }
  head.append(row);
  const body = document.createElement("tbody");
  for (const task of visible) {
    const tr = document.createElement("tr"),
      name = document.createElement("td"),
      role = document.createElement("td"),
      status = document.createElement("td"),
      button = document.createElement("button");
    button.textContent = task.title;
    button.onclick = () => selectTask(task.id);
    name.append(button);
    role.textContent = task.assignments
      .map((a) => roleName(roles.find((r) => r.id === a.roleId)))
      .join(" · ");
    status.append(makeStatus(task.status));
    tr.append(name, role, status);
    body.append(tr);
  }
  table.append(head, body);
  root.append(table);
}
function selectTask(id) {
  selected = id;
  office.select?.(id);
  for (let i = 0; i < office.seats.length; i++)
    office.overlay.children[i]?.classList.toggle(
      "selected",
      office.seats[i].task.taskId === id,
    );
  renderDetails();
  for (const button of document.querySelectorAll(".studio-task")) button.classList.toggle("selected", button.dataset.taskId === id);
  if (innerWidth < 1100 && !focusView.active && document.documentElement.dataset.studio !== "architectural")
    $("#task-details").scrollIntoView({
      behavior: settings.motion ? "smooth" : "auto",
      block: "nearest",
    });
}
function renderDetails() {
  controls.refreshTask();
  slapControls.refresh();
  const task = tasks.find((task) => task.id === selected),
    root = $("#task-details"),
    locale = getLocale();
  root.classList.toggle("has-task", Boolean(task));
  if (!task) {
    selected = null;
    if (root.dataset.render !== `empty-${locale}`) {
      root.dataset.render = `empty-${locale}`;
      root.replaceChildren();
      const kicker = document.createElement("div");
      kicker.className = "section-kicker";
      kicker.textContent = t("atYourDesk");
      const empty = document.createElement("div");
      empty.className = "empty-detail";
      const icon = document.createElement("canvas");
      icon.className = "empty-portrait";
      icon.width = 38;
      icon.height = 44;
      icon.setAttribute("aria-hidden", "true");
      const title = document.createElement("h3");
      title.textContent = t("chooseDesk");
      const p = document.createElement("p");
      p.textContent = t("chooseDeskHelp");
      empty.append(icon, title, p);
      root.append(kicker, empty);
      refreshBadges();
    }
    return;
  }
  const key = JSON.stringify([
    task.id,
    task.title,
    task.assignments,
    task.status,
    task.project,
    task.summary,
    task.url,
    roles,
    locale,
  ]);
  if (root.dataset.render === key) {
    const seen = root.querySelector("[data-observed]");
    if (seen)
      seen.textContent = `${t("observedAt")} ${formatDate(task.observedAt)}`;
    return;
  }
  root.dataset.render = key;
  root.replaceChildren();
  const kicker = document.createElement("div");
  kicker.className = "section-kicker";
  kicker.textContent = task.sample ? "示例任务" : task.provider || "外部任务";
  const title = document.createElement("h3");
  title.className = "task-title";
  title.textContent = task.title;
  const meta = document.createElement("p");
  meta.className = "task-meta";
  meta.textContent = projectName(task) || t("projectUnset");
  const summary = document.createElement("p");
  summary.className = "task-meta";
  summary.textContent = task.sample ? "用于体验完整办公室的示例任务。" : t(
    task.status === "unknown"
      ? "staleObservation"
      : task.source === "work"
        ? "cloudHelp"
        : task.status === "done"
          ? "turnComplete"
          : "localObservation",
  );
  const seen = document.createElement("p");
  seen.className = "task-meta";
  seen.dataset.observed = "";
  seen.textContent = `${t("observedAt")} ${formatDate(task.observedAt)}`;
  const assignmentText = document.createElement("p");
  assignmentText.className = "task-meta";
  assignmentText.textContent = t(
    task.reason === "activity"
      ? "classificationActivity"
      : task.reason === "manual"
        ? "manualRole"
        : "classificationTitle",
  );
  const chips = document.createElement("div");
  chips.className = "detail-role-list";
  for (const assignment of task.assignments) {
    const chip = document.createElement("span");
    chip.className = "assignment-chip";
    chip.textContent = roleName(
      roles.find((role) => role.id === assignment.roleId),
    );
    chips.append(chip);
  }
  const label = document.createElement("label");
  label.className = "detail-role-label";
  label.htmlFor = "detail-role";
  label.textContent = t("roleLabel");
  const select = document.createElement("select");
  select.id = "detail-role";
  select.append(new Option(t("autoAssign"), ""));
  roles.forEach((role) => select.append(new Option(roleName(role), role.id)));
  select.value = settings.overrides[task.id] || "";
  select.onchange = () => {
    if (select.value) settings.overrides[task.id] = select.value;
    else delete settings.overrides[task.id];
    persist();
    applyState.lastKey = null;
    applyState(state);
    toast(t("roleUpdated"));
  };
  root.append(
    kicker,
    title,
    makeStatus(task.status),
    meta,
    summary,
    seen,
    assignmentText,
    chips,
    label,
    select,
  );
  if (task.url && safeTaskUrl(task.url)) {
    const link = document.createElement("a");
    link.href = task.url;
    link.textContent = t("openTask");
    link.append(studioIcon("box-arrow-up-right"));
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    root.append(link);
  }
  const detailToggle = document.createElement("button");
  detailToggle.type = "button"; detailToggle.className = "studio-detail-toggle";
  const labelDetails = () => detailToggle.textContent = getLocale() === "zh"
    ? (root.classList.contains("expanded") ? "收起详情" : "更多详情")
    : (root.classList.contains("expanded") ? "Less detail" : "More detail");
  labelDetails();
  detailToggle.onclick = () => { root.classList.toggle("expanded"); labelDetails(); };
  root.append(detailToggle);
}
function safeTaskUrl(value) {
  try {
    const url = new URL(value);
    return (
      (["https:","http:"].includes(url.protocol) && !url.username && !url.password)
    );
  } catch {
    return false;
  }
}
function formatDate(value) {
  const n = Date.parse(value);
  return Number.isFinite(n)
    ? new Date(n).toLocaleString(getLocale(), {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
}
function renderHealth() {
  const connection = $("#connection");
  connection.classList.toggle("disconnected", !connected && !demo);
  connection.lastChild.textContent = ` ${t(demo ? "demoOffice" : connected ? "localConnected" : "reconnecting")}`;
  $("#last-sync").textContent = demo
    ? t("demoOffice")
    : `${t("lastSync")} ${formatDate(state.updatedAt)}`;
  const health = state.health || {},
    cloud = state.cloud || {};
  $("#source-summary").textContent = '本机任务 '+tasks.length+' · 手动 / 文件 / HTTP';
  $("#health-details").textContent = health.message || '通用任务连接，不需要 GPT 账号';
  $("#demo-toggle").textContent =
    `${t(publicDemo ? "downloadApp" : demo ? "liveButton" : "demoButton")} ↗`;
  $("#demo-step").hidden = !demo;
  const notice = $("#notice");
  if (demo) {
    notice.hidden = false;
    notice.textContent = t(publicDemo ? "publicDemoNotice" : "demoNotice");
  } else if (
    !connected ||
    health.status === "unavailable" ||
    health.status === "partial"
  ) {
    notice.hidden = false;
    notice.textContent = initial && !connected ? (getLocale() === "zh" ? "正在连接本机任务…" : "Connecting to local tasks…") : t(!connected ? "connectionLost" : "healthUnknown");
  } else { notice.hidden=!tasks.some(task=>task.sample); notice.textContent='示例任务 · 当前是完整办公室，示例不代表正在执行的 AI 工作。点击「任务接入」换成自己的任务。'; }
}
async function refreshLiveSnapshot() {
  if (demo || publicDemo || liveSnapshotRequest) return liveSnapshotRequest;
  liveSnapshotRequest = (async () => {
    try {
      const response = await fetch('/api/state', {cache:'no-store'});
      if (!response.ok) throw new Error(`State unavailable: ${response.status}`);
      const next = await response.json();
      liveState = next;
      connected = true;
      applyState(next);
    } catch (error) {
      connected = false;
      console.error('Workroom snapshot refresh failed', error);
      renderHealth();
    } finally { liveSnapshotRequest = null; }
  })();
  return liveSnapshotRequest;
}
async function connect() {
  if (publicDemo) {
    demo = true;
    await workPicker.setScope("demo");
    $("#download-app").hidden = false;
    $("#pair-show").disabled = true;
    fetch("./demo-data.json")
      .then((response) => {
        if (!response.ok) throw new Error("Demo unavailable");
        return response.json();
      })
      .then((data) => {
        connected = true;
        applyState({ ...data, demo: true });
      })
      .catch(() => {
        connected = false;
        toast(t("demoFailed"));
      });
    return;
  }
  await workPicker.setScope("live");
  await refreshLiveSnapshot();
  source = new EventSource("/api/events");
  source.onmessage = async (event) => {
    try {
      const next = JSON.parse(event.data);
      lastLiveEventAt = Date.now();
      connected = true;
      liveState = next;
      if (!demo) {
        if (next.demo) {
          demo = true;
          state = next;
          await workPicker.setScope("demo");
        }
        applyState(next);
      }
    } catch (error) {
      console.error("Workroom render failed", error);
      toast(t("readFailed"));
    }
  };
  source.onerror = () => {
    connected = false;
    if (!demo)
      applyState({
        ...state,
        tasks: state.tasks.map((task) => ({ ...task, status: "unknown" })),
      });
    renderHealth();
    void refreshLiveSnapshot();
  };
}
setInterval(() => {
  if (!demo && !document.hidden && Date.now() - lastLiveEventAt > 12000) void refreshLiveSnapshot();
}, 8000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !demo && Date.now() - lastLiveEventAt > 12000) void refreshLiveSnapshot();
});
$("#project-help-open").onclick = () => $("#project-info-dialog").showModal();
$("#status-filter").onchange = (event) => {
  void workPicker.setStatus(event.target.value);
};
document.querySelectorAll("[data-filter]").forEach(
  (button) =>
    (button.onclick = () => {
      void workPicker.setStatus(
        filterStatus === button.dataset.filter ? "" : button.dataset.filter,
      );
    }),
);
$("#zoom-in").onclick = () => office.setScale(office.scale + 0.1);
$("#zoom-out").onclick = () => office.setScale(office.scale - 0.1);
$("#zoom-fit").onclick = () => office.fit();
function setView(list) {
  document.body.classList.toggle("studio-list-mode", list);
  $("#jobs-table").hidden = !list;
  $("#office-viewport").hidden = list;
  $("#office-view").classList.toggle("active", !list);
  $("#office-view").setAttribute("aria-pressed", !list);
  $("#list-view").classList.toggle("active", list);
  $("#list-view").setAttribute("aria-pressed", list);
  if (!list) office.fit();
  syncAudio();
}
$("#office-view").onclick = async () => { await workPicker.setStatus("working"); setView(false); };
$("#list-view").onclick = async () => { await workPicker.setStatus(""); setView(true); };
$("#sound-toggle").onclick = () => setSound(!settings.sound);
$("#motion-toggle").onclick = () => setMotion(!settings.motion);
$("#studio-rooms").onclick = () => {
  settings.studioShowEmpty = !settings.studioShowEmpty;
  persist();
  render();
};
$("#studio-all-tasks").onclick = () => {
  filterStatus = "";
  $("#status-filter").value = "";
  selectedRole = "";
  void workPicker.setStatus("");
  setView(true);
  render();
};
$("#sound-setting").onchange = (event) => setSound(event.target.checked);
$("#motion-setting").onchange = (event) => setMotion(event.target.checked);
$("#volume-setting").oninput = (event) => {
  settings.volume = Number(event.target.value) / 100;
  persist();
  syncAudio();
};
$("#test-sound").onclick = () => soundscape.preview($("#sound-preview").value);
$("#office-sounds-setting").onchange = (event) => {
  settings.officeSounds = event.target.checked;
  persist();
  syncAudio();
};
$("#language-quick").onchange = (event) => language(event.target.value);
$("#language-setting").onchange = (event) => language(event.target.value);
$("#theme-setting").onchange = (event) => setTheme(event.target.value);
$("#theme-toggle").onclick = () =>
  setTheme(
    document.documentElement.dataset.theme === "light" ? "graphite" : "light",
  );
$("#walking-setting")?.addEventListener("change", (event) => {
  settings.walking = event.target.checked;
  persist();
  settingsUI();
});
$("#settings-open").onclick = () => {
  $("#settings-dialog").showModal();
  settingsUI();
};
$("#connection").onclick = () => connectionGuide.open();
$("#connection-guide-open").onclick = () => {
  $("#settings-dialog").close();
  connectionGuide.open();
};
$("#settings-dialog").addEventListener("close", () => {
  $("#pair-area").hidden = true;
  $("#pair-token").value = "";
});
$("#pair-show").onclick = async () => {
  try {
    const response = await fetch("/api/pair");
    if (!response.ok) throw Error();
    const data = await response.json();
    $("#pair-token").value = data.token;
    $("#pair-area").hidden = false;
  } catch {
    toast(t("pairFailed"));
  }
};
$("#pair-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("#pair-token").value);
    toast(t("pairCopied"));
  } catch {
    $("#pair-token").select();
    toast(t("copyManually"));
  }
};
$("#add-role").onclick = () => {
  $("#role-dialog").showModal();
  $("#role-name").focus();
};
$("#role-close").onclick = () => $("#role-dialog").close();
$("#role-form").onsubmit = (event) => {
  event.preventDefault();
  const name = $("#role-name").value.trim();
  if (!name) return;
  settings.roles.push({
    id: `custom-${crypto.randomUUID()}`,
    name,
    color: $("#role-color").value,
    keywords: $("#role-keywords")
      .value.split(/[,、\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  });
  persist();
  $("#role-dialog").close();
  $("#role-form").reset();
  applyState.lastKey = null;
  applyState(state);
  toast(t("roleAdded", { name }));
};
$("#demo-toggle").onclick = async () => {
  if (publicDemo) {
    window.open(
      "https://github.com/mooi218/workroom/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    return;
  }
  initial = true;
  previous.clear();
  selected = null;
  selectedRole = "";
  applyState.lastKey = null;
  if (demo) {
    if (liveState) {
      demo = Boolean(liveState.demo);
      state = liveState;
      await workPicker.setScope(demo ? "demo" : "live");
      if (demo) toast(t("demoOnly"));
      applyState(liveState);
    }
    return;
  }
  try {
    const response = await fetch("/api/demo");
    if (!response.ok) throw Error();
    const next = await response.json();
    demo = true;
    state = next;
    await workPicker.setScope("demo");
    applyState(next);
  } catch {
    toast(t("demoFailed"));
  }
};
$("#demo-step").onclick = () => {
  if (!demo) return;
  const job = state.tasks.find(
    (task) => task.status === "working" && workPicker.matches(task),
  );
  if (!job) {
    toast(t("noTasks"));
    return;
  }
  const time = new Date().toISOString();
  applyState({
    ...state,
    updatedAt: time,
    tasks: state.tasks.map((task) =>
      task.id === job.id
        ? {
            ...task,
            status: "done",
            activeRoles: [],
            updatedAt: time,
            observedAt: time,
          }
        : task,
    ),
  });
};
reduced.addEventListener("change", (event) => {
  if (event.matches) setMotion(false);
});
darkSystem.addEventListener("change", () => settingsUI());
document.addEventListener("visibilitychange", syncAudio);
document.addEventListener(
  "pointerdown",
  () => {
    if (settings.sound) audioReady();
  },
  { once: true },
);
document.addEventListener(
  "keydown",
  () => {
    if (settings.sound) audioReady();
  },
  { once: true },
);

function studioIcon(name) {
  const image = document.createElement("img");
  image.src = `./assets/bi-${name}.svg`; image.alt = ""; image.setAttribute("aria-hidden", "true");
  image.width = 18; image.height = 18; return image;
}
function studioButton(id, icon, label) {
  const node = $(id); if (!node) return;
  const text = document.createElement("span"); text.textContent = label;
  node.replaceChildren(studioIcon(icon), text);
}
function refreshStudioIcons() {
  if (!$("#studio-dock")) return;
  const zh = getLocale() === "zh";
  $("h1").textContent = "newme office";
  if (zh) $("#walking-help").textContent = "工作间隙，成员可在工作区内短暂走动。";
  $("#office-view").textContent = zh ? "办公室" : "Office";
  $("#list-view").textContent = zh ? "全部任务" : "All tasks";
  $("#settings-open").replaceChildren(studioIcon("gear"));
  $("#theme-toggle").replaceChildren(studioIcon(document.documentElement.dataset.theme === "light" ? "moon" : "sun"));
  studioButton("#motion-toggle", settings.motion ? "pause" : "play", `${t("motion")} ${t(settings.motion ? "on" : "off")}`);
  studioButton("#sound-toggle", settings.sound ? "volume-up" : "volume-mute", `${t("sound")} ${t(settings.sound ? "on" : "off")}`);
  studioButton("#zoom-fit", "fullscreen", zh ? "适应窗口" : "Fit view");
}
function setupStudioShell() {
  const nav = document.createElement("nav"); nav.setAttribute("aria-label", "工作视图"); nav.className = "view-switch";
  nav.append($("#office-view"), $("#list-view"));
  $(".app-header").insertBefore(nav, $(".header-tools"));
  const dock = document.createElement("footer"); dock.id = "studio-dock";
  dock.append($("#zoom-fit"));
  const divider = document.createElement("span"); divider.className = "dock-divider"; divider.setAttribute("aria-hidden", "true");
  dock.append(divider, $("#motion-toggle"), $("#sound-toggle"), $("#zoom-out"), $("#zoom-label"), $("#zoom-in"), $("#focus-toggle"), $(".studio-clock"));
  $("main").append(dock);
  const options = document.createElement("details"); options.id = "studio-options";
  const summary = document.createElement("summary"); summary.textContent = "更多设置 · 工作区与团队";
  const body = document.createElement("div"); body.className = "studio-options-body";
  body.append($("#teams"), $("#add-role"), $("#studio-rooms"), $("#demo-toggle"), $(".command-panel"), $("#codex-usage"));
  options.append(summary, body);
  options.open=settings.moreSettingsOpen;
  options.addEventListener("toggle",()=>{settings.moreSettingsOpen=options.open;persist();});
  $("main").append(options);
}
setupStudioShell();
setupOfficeControls();

function setupOfficeControls() {
  const picker = document.createElement("label");
  picker.className = "scene-style-picker";
  const label = document.createElement("span");label.textContent = "界面";
  const select = document.createElement("select");select.id = "scene-style";
  select.setAttribute("aria-label", "界面风格");
  select.append(new Option("现代空间", "modern"),new Option("像素办公室", "pixel"));
  select.value = settings.sceneStyle;
  const changeStyle = (value) => {settings.sceneStyle=value;office.setStyle(value);for(const node of document.querySelectorAll('[data-scene-picker]'))node.value=value;persist();};
  select.dataset.scenePicker="true";
  select.onchange = () => changeStyle(select.value);
  picker.append(label,select);$("#studio-dock").insertBefore(picker,$("#motion-toggle"));
  const controls=document.createElement("section");controls.id="boss-controls";controls.className="boss-controls";
  controls.setAttribute("aria-label","老板动作");
  const focusPicker=picker.cloneNode(true),focusSelect=focusPicker.querySelector("select");
  focusPicker.classList.add("focus-style-picker");focusSelect.id="scene-style-focus";focusSelect.setAttribute("aria-label","全屏界面风格");focusSelect.onchange=()=>changeStyle(focusSelect.value);controls.append(focusPicker);
  const toggleLabel=document.createElement("label"),toggle=document.createElement("input");
  toggle.type="checkbox";toggle.id="boss-visible";toggle.checked=settings.bossVisible;
  toggleLabel.append(toggle,document.createTextNode("Tanya · CEO"));controls.append(toggleLabel);
  for(const [action,name] of [["patrol","巡视"],["whip","挥鞭催工"],["encourage","鼓励"]]) {
    const button=document.createElement("button");button.type="button";button.textContent=name;button.dataset.action=action;button.setAttribute("aria-pressed","false");
    button.onclick=()=>{office.bossAction(action);if(action==='whip')void slapControls.playWhip();if(action==='encourage')void slapControls.playApplause();};controls.append(button);
  }
  const status=document.createElement("small");status.id="boss-status";status.setAttribute("role","status");status.textContent="观察团队工作";controls.append(status);
  controls.title="动作作用于画面中的选中任务";
  toggle.onchange=()=>{settings.bossVisible=toggle.checked;office.setBossVisible(toggle.checked);controls.dataset.hidden=String(!toggle.checked);persist();};
  controls.dataset.hidden=String(!settings.bossVisible);$(".office-panel").append(controls);
  office.setBossVisible(settings.bossVisible);
}

localize();
connect();
document.fonts?.ready.then(() => office.draw());

function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat(getLocale(), {timeZone:"Asia/Dubai",month:"short",day:"numeric",weekday:"short"}).format(now);
  $("#clock-date").textContent = date;
  $("#clock-date").dateTime = now.toISOString();
  $("#clock-time").textContent = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Dubai",hour:"2-digit",minute:"2-digit",hour12:false}).format(now);
  $("#clock-time").dateTime = now.toISOString();
}
updateClock();
setInterval(updateClock, 30000);


