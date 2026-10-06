# asdf10k-agentic-backend

Backend for the Agent window of [asdf10k](../asdf10k): a Claude agent (Claude Agent SDK, Claude
Code as a library) that analyses the graph the app has loaded, streams its progress to the window
and hands results back (images, tables, node columns, subsets, window suggestions).

For agents (and anyone changing code): `CLAUDE.md` (rules, commands, pitfalls) and `docs/`
(`architecture.md`, `sdk-notes.md`, `testing.md`). The plan, protocol decisions and phase status
live in the app repo: `../asdf10k/docs/agent-window-plan.md`. Keep both updated with every change.

## Status

Phases 0-4 done on 2026-10-06 (tags `phase-1` .. `phase-4`): spike, chat with progress, app
awareness (graph upload, app context, skills, Python), results into the app (actions, columns,
reports), and the app's capabilities (generated catalog skill, `run_app_command`). Details and
findings: the plan.

## Requirements

- Node >= 20, `npm install`.
- A `claude` CLI login on this machine (the SDK bundles its own Claude Code binary and uses the
  login from the Keychain; `apiKeySource: 'none'` in the init message means the claude.ai login is
  in use). The backend must run as a normal user: `bypassPermissions` refuses to start as root.
- `uv` for the Python environment the agent uses: `npm run setup:python` (= `uv sync` in
  `python/`, creates `python/.venv` with pandas, numpy, scipy, matplotlib, networkx, pyarrow). The
  backend puts `python/.venv/bin` first on the agent's PATH; `/health` reports `python: true`.

## Run

```bash
cp .env.example .env        # optional, defaults work
npm run setup:python        # once
npm run dev                 # tsx watch src/server.ts
npm run typecheck
npm test
```

## What a session gets

`<SESSIONS_DIR>/<id>/workspace/` is the agent's cwd. `input/` holds what the app sent: `nodes.tsv`
and `edges.tsv` (the app's whole graph with every column, re-uploaded when its hash changes),
`selection.tsv`, `subset_library.tsv`, `app_context.json`. Every user message is prefixed with an
`<app_context>` block rendered from the snapshot (`src/agent/appContext.ts`). The skills in
`agent-home/.claude/skills/` (`asdf10k-columns`, `asdf10k-app`) are loaded into every session via
`additionalDirectories`; the system prompt addition is `src/agent/systemPrompt.ts`.

Sessions (agent workspaces, event logs, proposals) live outside this repo, by default in
`../asdf10k-agentic-sessions/` (`SESSIONS_DIR`): Claude Code loads `.claude/` and `CLAUDE.md` from
every parent directory of the agent's working directory, so a workspace inside this repo would pull
in this repo's own notes.

## Spikes (phase 0)

```bash
npm run spike:phase0        # streaming input, skills, MCP tool, task tools, Bash, resume
npm run spike:interrupt     # interrupt a running tool, message folded into a running turn
```

Each run writes every SDK message to `spike/fixtures/<run>*.jsonl` and a `*-findings.json`; the
runs use the Claude login and take 30-60 s. The fixtures are the test data for the event
normaliser.

## Layout

- `agent-home/.claude/skills/` - static skills loaded into every session via `additionalDirectories`
  (`home-skill` is the spike's test skill).
- `spike/` - phase 0 scripts and fixtures.
- `src/` - the server (phase 1).

## Tools and actions (phase 3)

- `src/agent/appTools.ts`: the in-process MCP server `asdf10k` with `propose_node_columns`
  (validates a TSV against the uploaded graph: `src/agent/validate/columnsTsv.ts`, emits a
  `proposal` event) and `publish_report` (front matter + body: `src/agent/validate/report.ts`,
  emits a `report` event). One server per live session.
- Actions in markdown (`cmd:` links, ```` ```asdf10k ```` blocks) need no tool; the app validates and
  runs them and posts what happened to `POST /sessions/:id/feedback`, which is prefixed to the
  next prompt ("since your last message the user: ...").
- Skills: `asdf10k-columns`, `asdf10k-app` (actions syntax), `asdf10k-reports` (front matter,
  roles, template).

## Model and speed

`AGENT_MODEL` (default `claude-sonnet-5-5`) and `AGENT_EFFORT` (default `medium`) set the session
agent's model and reasoning effort (`src/agent/agentOptions.ts`); the "What's up?" side query uses
`ASIDE_MODEL` (default Haiku 4.5) at low effort. The prototype's 45 runs on the login's default
(Opus 5.5, high effort) had a median of 17.9 s, 16 s of it model time over 3 turns; Sonnet at
medium is the fast default for app work, Opus at high the choice for research sessions (phase 5
profiles will set this per profile). Changing the model needs a backend restart (the live query is
created with it; a resumed session keeps its history).

## Stalls, restarts and "What's up?"

- A run whose model request never answers would spin forever. The stall watchdog
  (`SessionManager.watchStall`) emits `status: waiting` (not persisted) when no SDK message arrived
  for `RUN_STALL_WARN_S` (90 s) and, after `RUN_STALL_ABORT_MIN` (10 min), an `error` event,
  interrupts the agent and closes it; the agent's exit ends the run.
- `SIGTERM` / `SIGINT` (a restart) emit an error line into every running session and end its run
  before exiting; on startup `init()` ends any run that is still open in a log (`endOpenRun`:
  error + `run_end interrupted`), so windows never keep a spinner from a run whose process is
  gone. `POST /sessions/:id/interrupt` does the same for a session without a live agent.
- `POST /sessions/:id/aside { text? }` ("What's up?" in the window after 3 min): `src/agent/aside.ts`
  forks the SDK session at its current transcript (`forkSession`, `maxTurns: 1`, no tools) and
  asks what has been done / is running / is left; the answer is logged as an `aside` event under
  the current run. Works while the main run is waiting, because it is a separate process.

## Voice input

`POST /api/transcribe` (16 kHz mono 16-bit WAV body) returns `{ text, language, durationMs }` for
the Agent window's push-to-talk button (`src/transcribe/whisper.ts`). It shells out to whisper.cpp's
`whisper-cli` (`brew install whisper-cpp`; Metal on Apple Silicon) with a ggml model found in
`WHISPER_MODELS_DIR` (default `../asdf10k-agentic-models`, best model first:
`ggml-large-v3-turbo-q8_0.bin`). `/health` reports `transcribe: { available, model, problem }`; the
app hides the button when it is off. Env: `WHISPER_CPP_BIN`, `WHISPER_MODEL`, `WHISPER_MODELS_DIR`,
`WHISPER_LANG` (default `auto`; `en` / `de` skip detection), `WHISPER_THREADS` (4).

Model choice (whisper.cpp quantisations of large-v3-turbo): **q8_0** (874 MB) is practically
lossless against f16 and is the default; **q5_0** (574 MB) is a little worse on names and
non-English and only worth it when memory is tight; plain large-v3 is 6-8x slower for a small
accuracy gain. On an M3 a 7 s clip takes about 4 s cold (model load included), ~1 s warm; calls are
queued one after another. Download:

```bash
mkdir -p ../asdf10k-agentic-models && cd ../asdf10k-agentic-models
curl -L -O https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin
```

## The app's capabilities (phase 4)

- The app sends its **catalog** with a message when its hash changes (`PostMessageRequest.catalog`:
  ring menu settings with options, actions, windows with purpose / scope / options, commands with
  JSON Schemas). `src/agent/catalogSkill.ts` renders it into the generated skill
  `<workspace>/.claude/skills/asdf10k-app-catalog/SKILL.md` and the session reloads its skills; the
  catalog is kept in the session meta for the policy check.
- `run_app_command` (`src/agent/appTools.ts`): the agent runs an app command. `src/agent/appCommandPolicy.ts`
  allows `compute` (`rwr.run`, `cluster.run`) and the camera / layout actions (`nav.*`, `layout.*`); the view changes `settings.set`,
  `window.open`, `window.configure`, `window.close` are refused with a hint to write a card (the
  app renders `asdf10k` blocks and `cmd:` links to them as change cards with Revert; blocks apply
  themselves when the user's auto-accept is on); `selection` and `data` commands are refused with
  a hint to offer a button. Feedback from cards carries `proposalId` / `outcome` / `data` and is
  persisted, so the app restores card states on replay. The
  session emits a non-persisted `app_request` event, the Agent window runs the command, re-uploads
  the graph when it changed and answers at `POST /sessions/:id/app-results/:requestId`; the tool
  result lists the command's result, new columns and the viz settings now. 120 s timeout, an error
  when no window is attached.
- Read-only settings: the catalog marks the `highlight.*` settings (highlight mode: how the
  selection is marked, fade others) `readOnly`; the skill explains them and tells the agent to
  describe the change in the app's Settings window instead of calling `settings.set` (the app
  refuses those ids anyway).
- The snapshot carries the current viz settings (`viz`); `src/agent/appContext.ts` renders them
  into the `<app_context>` block. The prompt (`src/agent/systemPrompt.ts`) and the `asdf10k-app`
  skill say: app tools before Python, apply a setting when asked and suggest it with a settings
  card (```` ```asdf10k {"type":"settings",...} ````) otherwise, suggest windows as
  `cmd:window.open?type=...` buttons.
