# Architecture

One Hono server (`src/server.ts`, `/api/...`, port 8787), one `SessionManager`, one live Claude
agent per session that has been talked to recently. Everything the window shows is an event in the
session's log; the window replays the log on attach and then follows the SSE stream.

## Modules

| File | Role |
|---|---|
| `src/connectHints.ts` | Start-up lines: the app's `?agent=` URL for this machine and, with `AGENT_HOST=0.0.0.0`, per LAN address (plus the browser flag an HTTPS app on another device needs) |
| `src/server.ts` | Routes (below), SSE replay + live stream, gzip graph upload, workspace file serving, `/transcribe`, SIGTERM / SIGINT shutdown |
| `src/config.ts` | `.env` (optional) -> `config`: port and host (`AGENT_PORT`, `AGENT_HOST`, default 127.0.0.1 - no authentication; invalid values fall back), app URL for the start-up hints (`AGENT_APP_URL`), sessions dir, idle close, fake mode, python bin, stall thresholds, whisper |
| `src/protocol.ts` | zod schemas of everything crossing the wire: events, snapshot, catalog, requests. **Copied to the app** (`asdf10k/src/agent/protocol.ts`) |
| `src/sessions/SessionManager.ts` | Session metas (`meta.json`), live sessions (`ensureLive`), `postMessage` (snapshot -> input files + `<app_context>`), graph upload, feedback, app requests, aside, interrupt, stall watchdog, idle close, startup repair |
| `src/sessions/EventLog.ts` | `events.jsonl` + `.seq` sidecar, append / read / subscribe; the seq counter survives restarts (gap 1000) |
| `src/agent/liveQuery.ts` | `LiveQuery` = one SDK `query()` in streaming-input mode with a push queue; `interrupt`, `close`, `reloadSkills` |
| `src/agent/agentOptions.ts` | The SDK options (cwd, resume, settingSources project, additionalDirectories, bypassPermissions, strictMcpConfig, env) |
| `src/agent/EventNormalizer.ts` | SDK messages -> protocol events: runs, text blocks (deltas + final), tool steps with labels (`toolLabel`, `summarizeCommand`), todos, status, interrupt bookkeeping |
| `src/agent/appContext.ts` | The `<app_context>` block put before every user message (dataset, columns, selection, library, open windows with ids, viz, what the user did since) |
| `src/agent/appTools.ts` | In-process MCP server `asdf10k`: `propose_node_columns`, `publish_report`, `run_app_command` |
| `src/agent/appCommandPolicy.ts` | Which commands `run_app_command` may run: the catalog's `presentation` per command (protocol 2: `direct` runs, `card` = change card, `button` = offered to the user); derived from `effect` for a protocol 1 catalog |
| `src/agent/catalogSkill.ts` | Renders the app's catalog (settings with scope, windows, commands with presentation) into the generated skill `asdf10k-app-catalog` in the session workspace |
| `src/agent/systemPrompt.ts` | The prompt appended to Claude Code's preset: identity (BigBrainz20k), audience (biologists / bioinformaticians, their datasets), files, cards vs links, policy, answer length (result first, at most 6 sentences or 5 bullets plus one table / card, no preamble or closing) |
| `src/agent/aside.ts` | "What's up?": a forked one-turn side query without tools |
| `src/agent/graphFiles.ts` | Reads `input/nodes.tsv` ids and columns (validation, column diff after a command) |
| `src/agent/validate/*` | TSV for `propose_node_columns`; report front matter / files / node ids for `publish_report` |
| `src/transcribe/whisper.ts` | whisper.cpp wrapper for `/transcribe` (binary / model discovery, queue, JSON output) |
| `src/fake/FakeAgent.ts` | Scripted `AgentRunner` for `AGENT_FAKE=1` |
| `agent-home/.claude/skills/` | Static skills loaded into every session: `asdf10k-app` (how to talk to the app), `asdf10k-columns`, `asdf10k-reports` |
| `python/` | `uv` project for the agent's Python venv (first on its PATH) |

## The path of a message

1. The window `POST /sessions/:id/messages { text, snapshot, catalog? }`. The snapshot (graph hash,
   columns with stats, selection, library, open windows with ids, viz settings) is written into the
   workspace as `input/selection.tsv`, `input/subset_library.tsv`, `input/app_context.json`; when
   the graph hash differs from `meta.graphHash` the window first `PUT /sessions/:id/graph` (gzip
   TSVs -> `input/nodes.tsv`, `input/edges.tsv`). A changed catalog hash rewrites the generated
   skill and reloads skills.
2. `SessionManager.postMessage` appends `user_message`, prefixes the text with `<app_context>`
   (`appContext.ts`, including the user's card clicks since the last message = feedback lines) and
   pushes it into the live query (`ensureLive` starts or resumes the SDK session by
   `meta.sdkSessionId`).
3. The SDK streams messages; `EventNormalizer.handle` turns them into `run_start`, `init`, `status`,
   `text_delta` (not persisted), `text`, `tool_start` / `tool_end`, `todos`, `run_end`. Tools
   (`appTools.ts`) emit `proposal`, `report`, `app_request` themselves.
4. Every event goes through the session's `emit` -> `EventLog.append` (seq, persisted or not) ->
   listeners: the SSE handlers of attached windows, and `SessionManager.onEvent` (meta status,
   sdkSessionId; stall watchdog bookkeeping).
5. The window renders; clicks on cards and buttons come back as `POST /sessions/:id/feedback`
   (persisted `feedback` events: card id, outcome, data for replay) and are told to the agent with
   the next message. `run_app_command` waits for `POST /sessions/:id/app-results/:requestId`.

## Session lifecycle

- `POST /sessions` creates `meta.json` + workspace; the first message starts the live query. The
  `init` event's `session_id` is stored as `meta.sdkSessionId`; later live queries pass it as
  `resume`, so history survives idle closes and restarts.
- Idle: a live session with no events for `IDLE_CLOSE_MIN` (15) and no running run is closed
  (`closeLive` -> `runner.close()`); the next message resumes it.
- Running: `meta.status = running`; a message during a run is pushed into the same query and the
  SDK folds it into the current turn (one `result`, `run_end.answeredMessageIds` lists both).
- Stall watchdog (`watchStall`): every 15 s while running; silence >= `RUN_STALL_WARN_S` ->
  `status: waiting` (not persisted); >= `RUN_STALL_ABORT_MIN` -> `error` event, interrupt, close;
  the agent's exit ends the run (`handleExit` -> `run_end interrupted`).
- Restart: SIGTERM / SIGINT -> `shutdown()` emits an error line into running sessions and ends
  their runs; `init()` on the next start ends any run still open in a log (`endOpenRun`) and
  recovers a missing `sdkSessionId` from the log's last `init`.
- Interrupt: `POST /sessions/:id/interrupt` -> SDK `interrupt()`; without a live agent it ends the
  open run in the log instead.
- Aside: `POST /sessions/:id/aside` forks the SDK session (`forkSession`, `maxTurns: 1`, no tools),
  logs an `aside` event; the main run is untouched.

## Tools and policy

- `propose_node_columns(path, columns, summary)`: validates the TSV (ids exist, kind suffixes,
  no duplicate columns) -> `proposal` event -> the window's columns card; the user clicks Add; the
  outcome arrives as feedback.
- `publish_report(path)`: front matter (title, summary, nodes with roles, tags) + body -> `report`
  event -> report card, Report / Reports windows in the app.
- `run_app_command(command, params)`: `appCommandPolicy.checkAppCommand` against the catalog the
  app sent; allowed -> `app_request` event (not persisted, 120 s) -> the window runs it and posts
  the result (new columns, viz, the transaction ids `txIds`) -> tool result text. Refused with a
  hint: `card` commands (view changes) and `button` commands (selection / data). The app refuses a
  non-`direct` command in an `app_request` too.
- Cards and links need no tool: the app parses ```` ```asdf10k ```` blocks and `cmd:` links in
  the markdown (`asdf10k/src/windows/agent/markdown.ts`, `changeCard.ts`, `subsetChip.ts`).

## API

| Method | Path | Body / result |
|---|---|---|
| GET | `/health` | version, protocol, sdkVersion, fake, python, liveSessions, transcribe |
| GET / POST | `/sessions` | list / create `{ dataset, title? }` |
| GET / DELETE | `/sessions/:id` | meta / remove |
| POST | `/sessions/:id/messages` | `{ text, snapshot?, catalog? }` -> 202 `{ messageId }` |
| PUT | `/sessions/:id/graph` | gzip JSON `{ graphHash, nodesTsv, edgesTsv }` |
| GET | `/sessions/:id/events?after=` | SSE: replay then live; `Last-Event-ID` reconnect; `ready` event after the replay |
| POST | `/sessions/:id/feedback` | `{ text, proposalId?, outcome?, data? }` |
| POST | `/sessions/:id/app-results/:requestId` | `{ ok, result?, error?, graphHash?, viz? }` |
| POST | `/sessions/:id/aside` | `{ text? }` -> `{ answer }` |
| POST | `/sessions/:id/interrupt` | -> `{ interrupted }` |
| GET | `/sessions/:id/files/*` | workspace files (images, TSVs, reports) |
| POST | `/transcribe` | 16 kHz mono 16-bit WAV -> `{ text, language, durationMs }` |

## Events

`user_message`, `run_start`, `init`, `status` (`requesting`, `tool_running`, `waiting`), `text_delta`
(not persisted), `text`, `tool_start`, `tool_end`, `todos`, `proposal`, `report`, `feedback`,
`app_request` (not persisted), `aside`, `run_end`, `error`. Every event has `seq` and `ts`; run
events have `runId` (`<session prefix>-r<n>`, n continues across restarts); text blocks have
`blockId` (`<runId>:<message index>:<block index>`), which the window also uses for card ids.
