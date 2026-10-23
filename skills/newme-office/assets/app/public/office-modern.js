import { t, roleName } from './i18n.js';

const ART = {
  background: 'newme-brand-background.png',
  logo: 'newme-logo.png',
  engineer: 'engineer.png',
  writer: 'writer.png',
  designer: 'designer.png',
  researcher: 'researcher.png',
};
const DESKS = [
  { role: 'engineering', x: 360, y: 190, size: 240, labelX: 484, labelY: 139, sheet: 'engineer', row: 0 },
  { role: 'research', x: 885, y: 140, size: 265, labelX: 1027, labelY: 96, sheet: 'researcher', row: 0 },
  { role: 'design', x: 475, y: 505, size: 290, labelX: 630, labelY: 438, sheet: 'designer', row: 0 },
  { role: 'writing', x: 965, y: 552, size: 270, labelX: 1115, labelY: 480, sheet: 'writer', row: 0 },
];

// The artwork supplies the room and people. Task labels, selection and states
// remain live UI, rather than text or status baked into the room image.
export class Office {
  constructor({ canvas, overlay, world, viewport, onSelect, onActivity }) {
    Object.assign(this, { canvas, overlay, world, viewport, onSelect, onActivity });
    this.ctx = canvas.getContext('2d');
    this.width = 1672; this.height = 941; this.scale = 1;
    this.canvas.width = this.width; this.canvas.height = this.height;
    this.assets = {}; this.seats = []; this.tasks = []; this.roles = [];
    this.page = 0; this.motion = true; this.wandering = false; this.selected = null;
    this.time = 0; this.frame = 0; this.destroyed = false;
    this.pager = document.createElement('div');
    this.pager.className = 'scene-pager'; this.pager.hidden = true;
    viewport.parentElement.append(this.pager);
    this.message = document.createElement('p');
    this.message.className = 'scene-message'; this.message.textContent = '正在载入 newme office…';
    viewport.parentElement.append(this.message);
    for (const [key, file] of Object.entries(ART)) {
      const img = new Image();
      img.onload = () => { this.assets[key] = img; this.draw(); };
      img.onerror = () => {
        this.message.hidden = false;
        this.message.textContent = '办公室素材暂时无法载入，请刷新重试。任务列表仍可使用。';
      };
      img.src = `./assets/${file}`;
    }
    this.timer = setInterval(() => {
      if (this.motion && !document.hidden && !this.viewport.hidden) {
        this.time += .12; this.frame++; this.draw();
      }
    }, 120);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(viewport);
  }
  setData(tasks, roles, selected) {
    this.tasks = tasks; this.roles = roles; this.selected = selected;
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.tasks.length / 4) - 1));
    this.layout();
  }
  layout() {
    const visible = this.tasks.slice(this.page * 4, this.page * 4 + 4);
    const free = new Set(DESKS.map((_, i) => i));
    const placed = [];
    // Prefer matching work areas, with overflow desks remaining usable.
    for (const task of visible) {
      let slot = DESKS.findIndex((desk, i) => free.has(i) && desk.role === task.roleId);
      if (slot < 0) slot = [...free][0];
      free.delete(slot);
      const desk = DESKS[slot];
      placed.push({ ...desk, x: desk.x, y: desk.y, w: desk.size, h: desk.size,
        task, role: this.roles.find(role => role.id === task.roleId), slot,
        key: task.taskId || task.id, seed: slot * 13 });
    }
    this.seats = placed;
    this.overlay.replaceChildren();
    for (const seat of placed) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'seat'; b.dataset.taskId = seat.key;
      b.dataset.status = seat.task.status || 'unknown';
      b.style.left = `${seat.labelX}px`; b.style.top = `${seat.labelY}px`;
      b.classList.toggle('selected', seat.key === this.selected);
      b.setAttribute('aria-pressed', String(seat.key === this.selected));
      b.setAttribute('aria-label', `${seat.task.title} · ${t(seat.task.status || 'unknown')}`);
      b.title = `${seat.task.title}\n${roleName(seat.role)} · ${t(seat.task.status || 'unknown')}`;
      const dot = document.createElement('i'); dot.className = seat.task.status || 'unknown';
      const label = document.createElement('span'); label.className = 'seat-label'; label.textContent = seat.task.title;
      b.append(dot, label); b.onclick = () => this.onSelect(seat.key);
      this.overlay.append(b); seat.button = b;
    }
    this.pager.replaceChildren();
    this.pager.hidden = this.tasks.length <= 4;
    if (!this.pager.hidden) {
      const prev = document.createElement('button'), next = document.createElement('button'), text = document.createElement('span');
      prev.type = next.type = 'button'; prev.textContent = '上一组'; next.textContent = '下一组';
      prev.disabled = this.page === 0; next.disabled = (this.page + 1) * 4 >= this.tasks.length;
      text.textContent = `${this.page * 4 + 1}–${Math.min(this.tasks.length, this.page * 4 + 4)} / ${this.tasks.length}`;
      prev.onclick = () => this.changePage(this.page - 1); next.onclick = () => this.changePage(this.page + 1);
      this.pager.append(prev, text, next);
    }
    this.world.dataset.empty = String(!this.tasks.length);
    this.message.hidden = Boolean(this.assets.background);
    if (!this.tasks.length && this.assets.background) {
      this.message.hidden = false; this.message.textContent = '当前筛选下没有任务';
    }
    this.fit(); this.draw();
  }
  changePage(page) {
    this.page = page;
    this.layout();
    this.onSelect(this.tasks[page * 4]?.taskId || this.tasks[page * 4]?.id);
  }
  select(id) {
    this.selected = id;
    const index = this.tasks.findIndex(task => (task.taskId || task.id) === id);
    if (index >= 0 && Math.floor(index / 4) !== this.page) {
      this.page = Math.floor(index / 4); this.layout();
    }
    for (const seat of this.seats) {
      seat.button?.classList.toggle('selected', seat.key === id);
      seat.button?.setAttribute('aria-pressed', String(seat.key === id));
    }
    this.draw();
    if (this.viewport.clientWidth < 650) {
      const seat = this.seats.find(s => s.key === id);
      if (seat) this.viewport.scrollLeft = Math.max(0, (seat.x + seat.size / 2) * this.scale - this.viewport.clientWidth / 2);
    }
  }
  setMotion(value) { this.motion = Boolean(value); this.draw(); }
  setWandering(value) { this.wandering = Boolean(value); }
  setTheme(value) { this.theme = value; this.draw(); }
  setBadges() {} // The mature studio does not render the old pixel mascots.
  fit() {
    if (!this.viewport.clientWidth || !this.viewport.clientHeight || this.viewport.hidden) return;
    const ws = this.viewport.clientWidth / this.width, hs = this.viewport.clientHeight / this.height;
    this.setScale(this.viewport.clientWidth < 650 ? Math.min(hs, Math.max(ws, .60)) : Math.min(ws, hs));
    const panKey = `${this.selected}:${this.viewport.clientWidth}`;
    if (this.viewport.clientWidth < 650 && this.autoPanKey !== panKey) {
      const seat = this.seats.find(item => item.key === this.selected);
      if (seat) this.viewport.scrollLeft = Math.max(0, (seat.x + seat.size / 2) * this.scale - this.viewport.clientWidth / 2);
      this.autoPanKey = panKey;
    }
  }
  setScale(value) {
    this.scale = Math.max(.18, Math.min(2, value));
    this.world.style.width = `${this.width * this.scale}px`; this.world.style.height = `${this.height * this.scale}px`;
    this.canvas.style.width = `${this.width * this.scale}px`; this.canvas.style.height = `${this.height * this.scale}px`;
    this.overlay.style.width = `${this.width}px`; this.overlay.style.height = `${this.height}px`;
    this.overlay.style.transform = `scale(${this.scale})`; this.overlay.style.transformOrigin = '0 0';
    const label = document.querySelector('#zoom-label'); if (label) label.textContent = `${Math.round(this.scale * 100)}%`;
  }
  draw() {
    if(this.destroyed)return;
    const ctx = this.ctx, background = this.assets.background;
    if (!background) return;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(background, 0, 0, this.width, this.height);
    if(this.assets.logo){
      ctx.save();ctx.translate(150,690);ctx.transform(1,.62,0,1,0,0);
      ctx.shadowColor='#20262933';ctx.shadowBlur=5;ctx.shadowOffsetX=4;ctx.shadowOffsetY=5;
      ctx.drawImage(this.assets.logo,0,0,240,240*this.assets.logo.naturalHeight/this.assets.logo.naturalWidth);ctx.restore();
    }
    this.message.hidden = Boolean(this.tasks.length);
    for (const seat of [...this.seats].sort((a, b) => a.y - b.y)) {
      const image = this.assets[seat.sheet]; if (!image) continue;
      const cw = image.naturalWidth / 3;
      const ch = seat.sheet === 'researcher' ? image.naturalHeight / 2 : image.naturalHeight;
      const active = seat.task.status === 'working' && this.motion;
      const frame = active ? Math.floor((this.frame + seat.seed) / 3) % 3 : 1;
      const subtleMovement = active ? Math.sin(this.time * 1.1 + seat.seed) * .5 : 0;
      const walkPhase = (this.time + seat.seed) % 48;
      const walking = active && this.wandering && seat.sheet === 'researcher' && walkPhase > 42;
      const walkDistance = walking ? Math.sin((walkPhase - 42) / 6 * Math.PI) : 0;
      ctx.drawImage(image, frame * cw, (walking ? 1 : seat.row) * ch, cw, ch,
        seat.x + walkDistance * 28, seat.y + subtleMovement + walkDistance * 9, seat.size, seat.size);
    }
    this.canvas.dataset.motion = String(this.motion);
    this.canvas.dataset.frame = String(this.frame);
    this.canvas.dataset.renderedTasks = String(this.seats.length);
  }
  destroy() { this.destroyed = true; clearInterval(this.timer); this.resize.disconnect(); }
}
