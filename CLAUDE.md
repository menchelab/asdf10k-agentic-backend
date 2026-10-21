# asdf10k-agentic-backend - notes for agents

Backend of the asdf10k Agent window ("BigBrainz20k"): a Claude agent per session through the
Claude Agent SDK (Claude Code as a library), an event log + SSE stream the window renders, in-process
MCP tools that hand results back into the app, speech to text for push-to-talk. Humans: `README.md`.
Mental model of the code: `docs/architecture.md`. Index of all docs: `docs/README.md` - look there
first. The plan, protocol decisions and phase history live in the app repo:
`../asdf10k/docs/agent-window-plan.md` (sections 5 API, 6 protocol, 15 SDK findings, 16 markdown
actions); the window side is `../asdf10k/docs/windows/agent.md`. Continuing the work (phase 5: sessions
overview, jobs, profiles, subagents): start with `../asdf10k/docs/agent-handover.md`.

**"Start the backend for <app URL>"** (a user, not a developer): follow the skill
`.claude/skills/start-backend/SKILL.md` - it starts the server and hands over the `?agent=` links
and the one-time certificate step other devices need (HTTPS on 8788 after `npm run cert`, mkcert;
the Chrome insecure-origin flag only without a certificate).

## Commands

- `npm run dev` - server with `tsx watch` on **127.0.0.1:8787** (`/api/...`; `AGENT_HOST=0.0.0.0` opens it - there is no authentication). `npm start` = no watch: after a
  code change you must restart it yourself (`pkill -f "tsx src/server.ts"`, start again; the log
  of a manual start is wherever you redirected it, e.g. `/tmp/agent-backend.log`).
- `npm run typecheck` (`tsc --noEmit`) and `npm test` (vitest, `test/`) - both clean, keep them at 0.
  There is no eslint here.
- `npm run setup:python` once (`uv sync` in `python/`): the agent's Python (pandas, numpy, scipy,
  matplotlib, networkx). `/health` reports `python: true` when the venv exists.
- `AGENT_FAKE=1 npm run dev` - scripted agent (`src/fake/FakeAgent.ts`), no Claude calls: text,
  steps, cards, a report. Use it for window work and protocol changes.
- Spikes: `npm run spike:phase0`, `npm run spike:interrupt` (30-60 s each, real Claude calls; the
  recorded messages in `spike/fixtures/` are the normaliser's test data).

## Rules

- **This repo is public** (menchelab/asdf10k-agentic-backend, MIT) since 2026-10-16: no secrets,
  hostnames, personal paths or account details in code, docs, fixtures or commit messages.
- **Commit continuously**, one commit per verified step (typecheck + tests, and a browser check in
  the app when the change is visible there). No `Co-Authored-By` or other trailers. Milestones get an
  annotated tag `phase-N`; releases are `npm run release` (tags `vX.Y.Z`, GitHub release). Never push
  (the user pushes and releases).
- **A restart stops every running session's run** (shutdown emits an error line and ends the run in
  the log; the user has to send again). Do not restart while someone is mid-run unless asked; say
  so when you did.
- **`src/protocol.ts` is copied to `../asdf10k/src/agent/protocol.ts`** (only the header comment
  differs). Change both in the same step, keep the zod schemas identical, bump `PROTOCOL_VERSION`
  for incompatible changes.
- Docs with every change: `README.md` (setup, env, features for humans), `docs/architecture.md`
  (how it works), `docs/sdk-notes.md` (new SDK facts), the app's `docs/agent-window-plan.md`
  (decisions, status) and `docs/windows/agent.md` (what the user sees). New env variables go into
  `.env.example` and `src/config.ts`.
- Prompt and skills (`src/agent/systemPrompt.ts`, `agent-home/.claude/skills/*/SKILL.md`,
  `src/agent/catalogSkill.ts`) are product text the user reads indirectly: short, concrete,
  with the exact command / block syntax. A skill change needs a backend restart; the generated
  catalog skill is rewritten per session when the app's catalog hash changes.

## Pitfalls

- **Sessions live outside the repo** (`SESSIONS_DIR`, default `../asdf10k-agentic-sessions/<id>/`):
  Claude Code loads `.claude/` and `CLAUDE.md` from every parent of the agent's cwd, so a workspace
  inside this repo would pull in this file. Per session: `meta.json`, `events.jsonl` (+ `.seq`),
  `workspace/` (agent cwd: `input/` from the app, `out/` from the agent, `.claude/skills/` the
  generated catalog skill). The SDK's own transcript is under
  `~/.claude/projects/-Users-...-<id>-workspace/<sdkSessionId>.jsonl` - read it when a run looks
  stuck (last message type and timestamp tell you where it hangs).
- **Event seq must only go up**: `EventLog` keeps the counter in `events.jsonl.seq` and jumps by
  1000 on reopen, because deltas take seq numbers without being persisted. Never reset it.
- **Run ids continue from the log** (`EventNormalizer(…, runsSoFar)`): a reopened session that
  restarted at `r1` put its answer into the window's old run block.
- **Meta writes are serialised per session** (`updateMeta` queue): `init` and `run_start` arrive
  together; a plain read-modify-write dropped `sdkSessionId`, and sessions then resumed without
  their history. Go through `updateMeta`, never `saveMeta` with a stale object.
- **SDK facts that shaped the code** (`docs/sdk-notes.md`): one `assistant` message per content
  block (same `message.id`), `init` again at every turn, messages sent during a run are folded into
  it (one `result`), foreground `sleep` is blocked by the harness, background tasks trigger a
  follow-up turn without a user message, in-process MCP tools need `alwaysLoad: true`,
  `strictMcpConfig` + `disableClaudeAiConnectors` keep the account's connectors out,
  `bypassPermissions` refuses to run as root.
- **Policy, not trust**: `run_app_command` runs only commands whose catalog `presentation` is
  `direct` (protocol 2, set by the app's command registry: `view` / `compute` commands); `card`
  commands (`settings.set`, `window.*`) must be cards, `button` commands (selection, data) buttons
  (`src/agent/appCommandPolicy.ts`; a protocol 1 catalog without `presentation` is derived from
  `effect` as before). The app checks an `app_request` the same way and enforces its own rules
  (read-only `highlight.*`).
- **Stall watchdog**: no SDK message for `RUN_STALL_WARN_S` -> `status: waiting`; after
  `RUN_STALL_ABORT_MIN` the run is stopped. On startup `init()` ends runs left open in any log.
  If a window shows a spinner that never ends, the log has a `run_start` without `run_end`.
- **Speech to text** needs `whisper-cli` on PATH (brew `whisper-cpp`) and a `ggml-*.bin` in
  `WHISPER_MODELS_DIR` (default `../asdf10k-agentic-models`, use `large-v3-turbo-q8_0`); input is
  16 kHz mono WAV from the browser, no ffmpeg involved. `/health` says why it is off.
- `app_request` events are not persisted and have a 120 s timeout: `run_app_command` only works
  while an Agent window is attached to the session.
- The backend runs as the logged-in user with the `claude` CLI login (`apiKeySource: 'none'`);
  there is no API key handling anywhere.

## Related repos

- App: `../asdf10k` (window `src/windows/AgentWindow.ts`, `src/windows/agent/*`, commands
  `src/app/registerAppCommands.ts`, catalog `src/agent/AppCatalog.ts`; its `CLAUDE.md` has the
  app rules - no native dialogs, actions are commands, docs with every change).
- Sessions: `../asdf10k-agentic-sessions`; models: `../asdf10k-agentic-models` (both outside git).
