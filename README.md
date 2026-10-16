# asdf10k-agentic-backend

Backend for **BigBrainz20k**, the AI agent window of the wwiznet / asdf10k 3D network explorer. A
Claude agent (Claude Agent SDK, Claude Code as a library) analyses the graph the app has loaded -
with Python (pandas, networkx, scipy) and the app's own tools - and hands results back into the
app: answers with tables and figures, new node columns, node sets, reports, view changes, analysis
windows, random walks and clustering. Optional voice input (push-to-talk) via whisper.cpp.

The app is a static web app: **[menchelab/wwiznet_dist](https://github.com/menchelab/wwiznet_dist)**
(setup and data guides in its `docs/for_agents/`). This backend runs next to a deployment of it;
without the backend the app works fully, only the BigBrainz20k window says "backend not reachable".

> **Security:** the backend has **no authentication**. Whoever can reach it can start agent sessions
> that run code on this machine and use your Claude account. By default it listens on `127.0.0.1`
> only. Open it to other machines only in a trusted network or behind a reverse proxy with access
> control.

## Quick start

On the machine that serves the app (or any machine the browser can reach):

```bash
git clone https://github.com/menchelab/asdf10k-agentic-backend.git
cd asdf10k-agentic-backend
npm install                       # Node >= 20
npm run setup:python              # the agent's Python environment (needs uv: https://docs.astral.sh/uv/)
claude                            # once: log in to Claude Code, then /exit (see "Claude access")
npm start                         # http://127.0.0.1:8787/api
curl http://127.0.0.1:8787/api/health
```

`/health` answers `{"ok":true, ..., "python":true, "transcribe":{...}}`. Then point the app at it
(next section) and open the **BigBrainz20k** window from the app's "+" menu: a green dot next to the
session list means connected. Try it without Claude first with `AGENT_FAKE=1 npm start` (a scripted
agent, no model calls).

## Connecting the app

The app looks for the backend at `/agent-api` on its own origin, or at the URL in the dataset's
`config.json` key `agentBackendUrl` (the backend's base URL **including `/api`**). Pick one:

| Setup | Backend | App side |
|---|---|---|
| **Everything on one machine** (testing, a lab workstation) | `npm start` (127.0.0.1:8787) | serve the deployment with its own `python3 server.py`: it forwards `/agent-api/` to `http://127.0.0.1:8787/api`; no config change |
| **Behind the deployment's web server** (recommended for shared deployments, HTTPS) | `npm start` on the server (127.0.0.1:8787) | reverse-proxy `/agent-api/` to `http://127.0.0.1:8787/api/`; no config key needed |
| **Backend on another machine in a trusted network** | `AGENT_HOST=0.0.0.0 npm start` | `"agentBackendUrl": "http://<backend-host>:8787/api"`; only works if the app is served over plain HTTP (see below) |

Rules that bite:

- **HTTPS pages cannot call an HTTP backend** (mixed content). A deployment served over HTTPS (any
  public site, or a Quest headset that opens it by network address instead of `localhost`) needs the
  backend behind HTTPS too - the reverse proxy setup does this.
- The backend answers with CORS (`*`) and `Cross-Origin-Resource-Policy: cross-origin`, so a
  different origin works when the scheme matches.
- Server-sent events: the proxy must not buffer `/agent-api/sessions/*/events` (nginx:
  `proxy_buffering off;`) and should allow long-lived connections.
- Uploads: the app uploads the graph gzip-compressed; allow request bodies of at least 50 MB.

nginx example (inside the deployment's `server { ... }`):

```nginx
location /agent-api/ {
    proxy_pass http://127.0.0.1:8787/api/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
    client_max_body_size 100m;
}
```

Caddy: `handle_path /agent-api/* { rewrite * /api{uri}  reverse_proxy 127.0.0.1:8787 { flush_interval -1 } }`.

## Claude access

The agent runs Claude Code through the Claude Agent SDK, which is bundled (`npm install` brings the
binary). It needs one of:

- **A Claude Code login** of the user who runs the backend: install Claude Code
  (`npm install -g @anthropic-ai/claude-code`), run `claude`, log in, `/exit`. The login is stored
  for that user and used by the backend (subscription usage).
- **An API key**: `ANTHROPIC_API_KEY=...` in the backend's environment (or `.env`); billed per token
  on the Anthropic API account.

The backend refuses to start as root (Claude Code's permission bypass does not allow it): run it as
a normal user. Model and speed: `AGENT_MODEL` / `AGENT_EFFORT` (below).

## Settings (`.env`)

Copy `.env.example` to `.env`; everything is optional.

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PORT` | `8787` | port |
| `AGENT_HOST` | `127.0.0.1` | interface; `0.0.0.0` = all (no authentication!). Own names on purpose: `PORT` / `HOST` are set by conda and others and are ignored |
| `SESSIONS_DIR` | `../asdf10k-agentic-sessions` | sessions, agent workspaces, event logs; must be **outside** this repo |
| `IDLE_CLOSE_MIN` | `15` | close an idle session's agent process after this many minutes (resumed on the next message) |
| `AGENT_MODEL` | `claude-sonnet-5-5` | model of the session agent; `claude-opus-5-5` for heavier research |
| `AGENT_EFFORT` | `medium` | reasoning effort: `low`, `medium`, `high`, ... |
| `ASIDE_MODEL` | `claude-haiku-4-5-20251001` | model of the "What's up?" side question |
| `RUN_STALL_WARN_S` / `RUN_STALL_ABORT_MIN` | `90` / `10` | a run without any model output shows "waiting" after the first, is stopped after the second |
| `AGENT_FAKE` | `0` | `1` = scripted fake agent (no Claude calls) |
| `WHISPER_CPP_BIN`, `WHISPER_MODELS_DIR`, `WHISPER_MODEL`, `WHISPER_LANG`, `WHISPER_THREADS` | PATH, `../asdf10k-agentic-models`, best model, `auto`, `4` | voice input (below) |
| `ANTHROPIC_API_KEY` | - | Claude access without a Claude Code login |

## Voice input (optional)

The push-to-talk button in the app appears when `/health` reports `transcribe.available`. Install
whisper.cpp (`brew install whisper-cpp`, or build it so that `whisper-cli` is on PATH) and put a
model into `../asdf10k-agentic-models/`:

```bash
mkdir -p ../asdf10k-agentic-models
curl -L -o ../asdf10k-agentic-models/ggml-large-v3-turbo-q8_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin
```

`large-v3-turbo-q8_0` (874 MB) is accurate and fast on Apple Silicon and on GPUs; on a weak CPU-only
machine use `ggml-small-q8_0.bin`.

## Running it permanently

`npm start` in the foreground is enough for a lab workstation. For a server, run it under a process
manager as the user who has the Claude login, for example a systemd user service:

```ini
# ~/.config/systemd/user/asdf10k-agent.service
[Unit]
Description=asdf10k agentic backend
[Service]
WorkingDirectory=%h/asdf10k-agentic-backend
ExecStart=/usr/bin/npm start
Restart=on-failure
[Install]
WantedBy=default.target
```

`systemctl --user enable --now asdf10k-agent`. A restart ends running agent turns (the window
shows "the backend restarted - send your message again"); the sessions and their files stay.

## Troubleshooting

| Symptom | Cause |
|---|---|
| The window says "backend not reachable" | backend not running, app not served by the deployment's `server.py` or a proxy, wrong `agentBackendUrl` (must end in `/api`), proxy path wrong, or HTTPS page with HTTP backend |
| `/health` fine, but messages fail | Claude access: run `claude` as the backend's user and log in, or set `ANTHROPIC_API_KEY`; the backend log shows the error |
| `"python": false` in `/health` | `npm run setup:python` not run (needs `uv`) |
| No microphone button | `transcribe.available` false: `/health` names the missing piece (binary or model) |
| Answers never finish | see the backend log; the stall watchdog stops a hung run after `RUN_STALL_ABORT_MIN` |
| Starts and exits immediately | running as root, or the port is in use |

## Development

```bash
npm run dev                 # tsx watch
npm run typecheck
npm test
npm run release -- minor    # version, changelog, tag, push, GitHub release (see Releases)
```

`CLAUDE.md` (rules, pitfalls) and `docs/` (`architecture.md`, `sdk-notes.md`, `testing.md`) are the
place to start for code changes; some notes refer to the app's source repository (`../asdf10k`),
which is private.

## How it works

### What a session gets

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

### Spikes (phase 0)

```bash
npm run spike:phase0        # streaming input, skills, MCP tool, task tools, Bash, resume
npm run spike:interrupt     # interrupt a running tool, message folded into a running turn
```

Each run writes every SDK message to `spike/fixtures/<run>*.jsonl` and a `*-findings.json`; the
runs use the Claude login and take 30-60 s. The fixtures are the test data for the event
normaliser.

### Layout

- `agent-home/.claude/skills/` - static skills loaded into every session via `additionalDirectories`
  (`home-skill` is the spike's test skill).
- `spike/` - phase 0 scripts and fixtures.
- `src/` - the server (phase 1).

### Tools and actions (phase 3)

- `src/agent/appTools.ts`: the in-process MCP server `asdf10k` with `propose_node_columns`
  (validates a TSV against the uploaded graph: `src/agent/validate/columnsTsv.ts`, emits a
  `proposal` event) and `publish_report` (front matter + body: `src/agent/validate/report.ts`,
  emits a `report` event). One server per live session.
- Actions in markdown (`cmd:` links, ```` ```asdf10k ```` blocks) need no tool; the app validates and
  runs them and posts what happened to `POST /sessions/:id/feedback`, which is prefixed to the
  next prompt ("since your last message the user: ...").
- Skills: `asdf10k-columns`, `asdf10k-app` (actions syntax), `asdf10k-reports` (front matter,
  roles, template).

### Model and speed

`AGENT_MODEL` (default `claude-sonnet-5-5`) and `AGENT_EFFORT` (default `medium`) set the session
agent's model and reasoning effort (`src/agent/agentOptions.ts`); the "What's up?" side query uses
`ASIDE_MODEL` (default Haiku 4.5) at low effort. The prototype's 45 runs on the login's default
(Opus 5.5, high effort) had a median of 17.9 s, 16 s of it model time over 3 turns; Sonnet at
medium is the fast default for app work, Opus at high the choice for research sessions (phase 5
profiles will set this per profile). Changing the model needs a backend restart (the live query is
created with it; a resumed session keeps its history).

### Stalls, restarts and "What's up?"

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

### Voice input

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

### The app's capabilities (phase 4)

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

## Releases

`npm run release -- [patch|minor|major]` (default minor): typecheck and tests, version bump,
`CHANGELOG.md` with every commit, commit `chore: release vX.Y.Z`, tag, push to
[menchelab/asdf10k-agentic-backend](https://github.com/menchelab/asdf10k-agentic-backend) and a GitHub
release with that version's changes. Pushes with the GitHub CLI login (`gh auth login`,
`gh auth setup-git`); `--no-push` stops after the local tag. Milestone tags `phase-N` stay as they are.

## License

MIT, see [LICENSE](LICENSE).
