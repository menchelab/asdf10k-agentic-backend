# Claude Agent SDK notes

Facts about `@anthropic-ai/claude-agent-sdk` (0.3.291, bundled Claude Code 2.1.291) that the code
relies on or works around. Found in the phase 0 spikes (`spike/`, fixtures in `spike/fixtures/`)
and later in production; the dated list with details is section 15 of
`../../asdf10k/docs/agent-window-plan.md`. Add new findings here.

## Login, options

- The CLI login works from the SDK: `init.apiKeySource` is `none` (claude.ai OAuth), default model
  `claude-opus-5-5`. `total_cost_usd` is an estimate, nothing is billed per token.
- `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` run tools without
  prompts; the process refuses to start as root. `AskUserQuestion` is disallowed (it would fall
  through to a prompt).
- `settingSources: ['project']` + `additionalDirectories: [agent-home]`: skills come from
  `<cwd>/.claude/skills` and `agent-home/.claude/skills` only, not from the user's `~/.claude`.
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` because auto memory loads regardless.
- Without `strictMcpConfig: true` and `settings: { disableClaudeAiConnectors: true }` the account's
  claude.ai connectors are attached to every session.
- In-process MCP tools (`createSdkMcpServer` + `tool()`) are *deferred* unless `alwaysLoad: true`:
  the model would have to `ToolSearch` for them first.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` gives `TaskCreate / TaskUpdate / ...`; ids come from
  `tool_use_result` (`{ task: { id } }` on create).

## Streaming input mode

- The `prompt` is an async iterable; we push `SDKUserMessage`s into a queue (`liveQuery.ts`). Set
  `uuid` on every pushed message: `result.user_message_uuids` tells which messages a turn answered.
- `init` is emitted again at the start of every turn (same `session_id`).
- **A message pushed during a run is folded into that run**: one `result` for both. The protocol
  therefore has `user_message` separate from `run_start` / `run_end`, and the window shows the
  second message as sent, not as a new pending run.
- `interrupt()` returns in milliseconds; the running tool gets an error `tool_result`, the turn ends
  with `result` `error_during_execution`, the query stays usable.
- After `close()`, `query({ resume: sessionId })` continues the conversation; the transcript lives
  in `~/.claude/projects/<cwd-with-dashes>/<sessionId>.jsonl`. `forkSession: true` with `resume`
  gives a copy to ask side questions without touching the original (used by "What's up?").

## Messages

- **One `assistant` message per content block**: a thinking block and the text of the same API
  message arrive as two `assistant` messages with the same `message.id`; the final text block's
  content index is always 0 while `stream_event`s index it within the API message. The normaliser
  keys messages by `message.id` and matches the final text to the streamed block by its text -
  without this the answer rendered twice.
- `stream_event` wraps raw Messages API events (`message_start`, `content_block_delta` with
  `text_delta`, ...) when `includePartialMessages: true`. Thinking deltas are not forwarded as text.
- `system` messages: `status` (`requesting` before each model call = "thinking"), `task_started` /
  `task_notification` (also for a foreground Bash longer than ~3 s), `background_tasks_changed`,
  `rate_limit_event` (subscription window status).
- **Harness rules apply to the agent**: a foreground `sleep N && ...` is blocked with a hint to use
  `run_in_background`. A backgrounded Bash ends the turn (`result` success) and, when it finishes,
  the session runs an **unsolicited follow-up turn** without a user message (new `init`, Bash,
  text, `result`). The normaliser starts a run with trigger `background_task` for it.
- `tool_use_result` of Bash is `{ stdout, stderr, interrupted, isImage, ... }`; of Skill it is the
  skill text; `Bash.description` is the harness' own short label (the prompt asks the agent to
  always fill it; `summarizeCommand` is the fallback).

## Things to keep in mind

- A hung API request produces silence: no message, no error, the child process idle. Nothing in the
  SDK times it out - hence the stall watchdog in `SessionManager`.
- The child process is a `claude` binary per live session (`claude-agent-sdk-darwin-arm64/claude
  --output-format stream-json ...`); `lsof -p <pid> -a -d cwd` tells which session it serves.
- `reloadSkills()` exists on the query and picks up a rewritten skill file without a restart.
