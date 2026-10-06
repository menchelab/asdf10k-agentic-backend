# asdf10k-agentic-backend

Backend for the Agent window of [asdf10k](../asdf10k): a Claude agent (Claude Agent SDK, Claude
Code as a library) that analyses the graph the app has loaded, streams its progress to the window
and hands results back (images, tables, node columns, subsets, window suggestions).

The plan, architecture, protocol and phase status live in the app repo:
`../asdf10k/docs/agent-window-plan.md`. Keep that file updated with every change here.

## Status

Phase 0 (spike) and phase 1 (chat with progress) done on 2026-10-06; phase 2 (app awareness:
graph upload, app context, skills, Python) built the same day. Details and findings: the plan.

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
