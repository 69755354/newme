---
name: newme-office
description: Install and run the complete newme office with modern and pixel views, animated staff and CEO, live task displays, microphone tap reactions, cartoon yelps, and applause. Use when the user wants the full local office or to connect tasks from any AI tool through JSON, CLI, or HTTP without a GPT account.
---

# Full newme office

This skill bundles the complete office in [assets/app](assets/app/), including the original modern architectural art, pixel room, employee sprites, Tanya's CEO animations, branding, task display and interaction sounds. Preserve both renderers and their bundled artwork. Do not replace them with the separate simplified `newme-interactions` demo.

## Install and verify

Requires Node.js 22+ and a modern browser with Canvas, Web Audio and AudioWorklet. There are no runtime npm dependencies, model calls, GPT-account requirements, or required Codex files. Optional `agents/openai.yaml` is only UI metadata; assistants that read SKILL.md can use the same workflow.

1. Locate this skill directory and an existing, user-writable workspace. Check `node --version`. If missing, report the prerequisite instead of silently installing global software.
2. Copy the bundled app using the installer, passing separate shell-quoted absolute paths:

   ```sh
   node /absolute/path/to/newme-office/scripts/install.mjs /absolute/path/to/workspace/newme-office-app
   ```

   The destination must be new and its parent must exist. The installer refuses overwrites and locations inside the installed skill. Customize the app copy rather than changing the skill's resources.
3. In the generated app directory run `npm test`, then `npm start`. Open or provide **http://127.0.0.1:4319/**. Use `--port` or `PORT` if occupied; do not stop unrelated services. Use a tracked terminal/process to stop this service. No browser is opened automatically by the server.
4. Verify `/api/health`, both office styles, artwork loading, equal task/worker counts, CEO controls, task creation/update and settings access. Respect an instruction not to control the user's desktop; an isolated headless browser can validate layout with audio muted and microphone disabled.

The first run includes clearly labeled fictional sample tasks so both complete scenes can be explored. They are not real AI work. The user can remove them from the task editor or start with `node server.mjs --empty` in a new data directory. A sample task cannot trigger an external feedback request.

## Connect real tasks

Read [assets/app/INTEGRATION.md](assets/app/INTEGRATION.md) for schemas and commands. Choose the available interface of the user's actual tool:

- Use **添加任务** for manual task display and state changes.
- Write `.newme-office/tasks.json`, use `scripts/tasks.mjs`, or publish to the authenticated loopback `/api/tasks` endpoint for a tool that can run scripts or HTTP requests.
- Preserve the publisher's task ID and turn ID. Publish state changes and optional final reply text explicitly. Task state is reported metadata, not proof of a running process or completed project. The office never silently starts or interrupts another AI tool.
- Read the API token only from the local data directory for local integrations. Do not print it, put it in the browser, commit it, or expose the server beyond loopback. Existing task/data files must survive updates.

The same shared task model drives both views. One task has one employee even when multiple roles are attached; both views use matching pagination. Keep source, project and status filters, delivery tray, persisted style and lower-page settings working.

## Interactions and feedback

Microphone recognition starts off and requires the current user's explicit page action and browser permission. Audio is analyzed locally, with no recordings or uploads; stop and release capture on disable/page close. Sound impulses can misclassify typing, claps and desk noise. Automated acoustic tests do not establish real-device accuracy or sound acceptance.

Whip plays a comic yelp and triggers the CEO animation; encourage plays applause and the corresponding animation. These manual actions never send task instructions. Keep mute and volume controls available. Do not play sounds on a busy user's desktop without their request.

Automatic dissatisfaction feedback is off by default and requires a selected non-sample task. Without `NEWME_FEEDBACK_URL`, feedback is only recorded locally. A configured receiver may accept a task-specific event; its authentication token stays server-side in `NEWME_FEEDBACK_TOKEN`. Preserve event IDs, saved unknown outcomes, and deduplication across restart. A 2xx response confirms acceptance only; require separate execution evidence before claiming that an AI task ran or was corrected. There is no built-in automatic adapter for every Claude, Cursor or other tool installation; implement an adapter only against the actual supported interface and user-authorized target.

## Deliver

Give the actual install path, tested URL, stop command and task connection mode. Include screenshots from the installed copy when useful. Distinguish installation, synthetic/headless validation and real microphone testing. Keep the full office and all required visual/audio assets in the delivered package; never describe the interaction-only kit as this complete office.
