# asdf10k-agentic-backend

Backend for the Agent window of [asdf10k](../asdf10k): a Claude agent (Claude Agent SDK, Claude
Code as a library) that analyses the graph the app has loaded, streams its progress to the window
and hands results back (images, tables, node columns, subsets, window suggestions).

The plan, architecture, protocol and phase status live in the app repo:
`../asdf10k/docs/agent-window-plan.md`. Keep that file updated with every change here.

## Status

Phase 0 (spike) done on 2026-10-06; findings in the plan, section 15. Phase 1 (chat with progress)
not started.

## Requirements

- Node >= 20, `npm install`.
- A `claude` CLI login on this machine (the SDK bundles its own Claude Code binary and uses the
  login from the Keychain; `apiKeySource: 'none'` in the init message means the claude.ai login is
  in use). The backend must run as a normal user: `bypassPermissions` refuses to start as root.
- `uv` for the Python environment the agent uses (`python/`, phase 2).

## Run

```bash
cp .env.example .env        # optional, defaults work
npm run dev                 # tsx watch src/server.ts (phase 1)
npm run typecheck
npm test
```

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
