---
name: newme-interactions
description: Install or integrate local microphone impact detection, comic whip and yelp animations, applause, and optional dissatisfaction feedback into a browser app. Use for requests to make a computer react to a tap, add playful task feedback, or run this interaction kit without a GPT account.
---

# newme interactions

Use the bundled application in [assets/app](assets/app/) to run the interaction kit or integrate its controller into an existing browser app. It needs Node.js 22+ and a browser with AudioWorklet; it has no runtime npm dependencies or model-account requirement. The skill instructions are portable to assistants that support SKILL.md; `agents/openai.yaml` is optional UI metadata.

## Run the kit

1. Locate this skill directory and check `node --version`. If Node is missing or below 22, report that prerequisite; do not silently install global software.
2. Choose a new application directory in the user's existing workspace (its parent must already exist). Run the installer by absolute path, passing the destination as a separate, shell-quoted argument:

   ```sh
   node /absolute/path/to/newme-interactions/scripts/install.mjs /absolute/path/to/workspace/newme-interactions-app
   ```

   The installer refuses existing destinations and never changes agent hooks, startup items, browser profiles, or unrelated apps. Keep the installed skill unchanged and customize the copied app.
3. Run `npm test` in the copied app, then `npm start`. Give the user `http://127.0.0.1:4320/`. If port 4320 is occupied, choose an unused port using `PORT`; do not terminate another service. The server binds only to loopback. Stop it using its terminal or tracked process, not a broad process kill.
4. Verify `/api/health`, the page, and sound asset responses. Leave microphone activation to the user's explicit page action. Do not play audio or take over an active desktop unless the user wants that demonstration.

See [assets/app/README.md](assets/app/README.md) for platform launchers, controls, detector limitations and development commands. A runtime check verifies startup, not real microphone accuracy or the user's approval of a sound.

## Integrate into an existing app

Read [assets/app/INTEGRATION.md](assets/app/INTEGRATION.md) when embedding the controller or connecting a feedback receiver. Keep `interactions.js`, `slap-detector.js`, `slap-worklet.js` and `sounds/` at their documented relative paths. Use the app's existing buttons and visual style when practical; preserve unrelated configuration.

- Start microphone capture only after the local user opts in. Analyze sound locally, store no recordings, upload no audio, and release the stream when disabled or the page closes. A sound impulse is an acoustic guess, not proof that the user hit the device or wants a particular edit.
- Whip plays a crack and comic electronic yelp; encouragement plays applause. Manual actions and simulated impacts do not send dissatisfaction feedback. Keep the mute and volume controls accessible.
- Automatic feedback is off by default. Enable it only for the user's selected receiver and intended task. The bundled receiver is a local demo and does not run an AI agent. Never invent a Claude, Cursor or other tool integration when its supported interface and target task are unknown.
- `NEWME_FEEDBACK_URL` is an optional HTTPS receiver (HTTP is allowed for loopback testing); `NEWME_FEEDBACK_TOKEN` stays server-side. Do not commit tokens. `.env.example` is documentation and is not loaded automatically.
- Preserve event IDs, receiver idempotency and the unknown-result/no-auto-retry behavior. Report HTTP acceptance as receiver acceptance; require execution evidence before saying that an AI task ran or was corrected.

## Deliver

Report the actual install path, tested URL, how to stop the service, and whether feedback is local-only or connected to a verified adapter. Separate automated checks from untested physical-device behavior. The bundled art is generic; no personal portraits, original office scene or private chat/task data are included. Code is MIT; generated sounds are CC0.
