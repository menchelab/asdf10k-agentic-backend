# Docs index

Backend of the asdf10k Agent window. Start with `../CLAUDE.md` (rules, commands, pitfalls), then:

| File | What |
|---|---|
| [architecture.md](architecture.md) | Module map, the path of a message (app -> SDK -> normaliser -> event log -> SSE -> window), session lifecycle, tools and policy, API routes and event types |
| [sdk-notes.md](sdk-notes.md) | What the Claude Agent SDK does that the code relies on or works around (one message per block, folded messages, background turns, connectors, resume, interrupt, ...) |
| [testing.md](testing.md) | How to verify a change: typecheck, vitest, fake agent, curl recipes, where a session's files and the SDK transcript are, how to read a stuck run |
| [../README.md](../README.md) | Setup for humans: requirements, run, Python, voice input, env variables |

The plan with every decision and the phase history is in the app repo:
`../../asdf10k/docs/agent-window-plan.md`; the window side in `../../asdf10k/docs/windows/agent.md`;
the app's commands (what the agent can trigger) in `../../asdf10k/docs/core/AppCommands.md`.
