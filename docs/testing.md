# Testing and debugging

## Checks before a commit

```bash
npm run typecheck        # tsc, must be clean
npm test                 # vitest: validation, normaliser (fixtures), event log, policy, catalog skill, app context
```

Changes the user sees go through the app in a desktop browser (`npm run dev` in `../asdf10k`, open
the BigBrainz20k window from the "+" menu). The app's `window.__perf.handles` has `openWindow`,
`selectNodes`, `runCommand`, `emit` for scripted checks (`../asdf10k/CLAUDE.md`).

## Running the backend for a check

```bash
npm run dev                     # watch mode, restarts on save (ends running runs!)
AGENT_FAKE=1 npm run dev        # scripted agent, no Claude calls
npx tsx src/server.ts > /tmp/agent-backend.log 2>&1 &   # manual, no watch: restart yourself after edits
curl -s localhost:8787/api/health
```

## curl recipes

```bash
B=http://localhost:8787/api
curl -s $B/sessions | head -c 600                                   # sessions, status, timestamps
curl -s -X POST $B/sessions -H 'Content-Type: application/json' -d '{"dataset":"data"}'
curl -N "$B/sessions/<id>/events?after=0"                           # SSE replay + live (Ctrl-C)
curl -s -X POST $B/sessions/<id>/messages -H 'Content-Type: application/json' -d '{"text":"hi"}'
curl -s -X POST $B/sessions/<id>/aside -H 'Content-Type: application/json' -d '{}'   # "What's up?"
curl -s -X POST $B/sessions/<id>/interrupt
curl -s -X POST $B/transcribe -H 'Content-Type: audio/wav' --data-binary @clip.wav
```

A test WAV without a microphone (macOS):
`say -o /tmp/t.aiff "colour the nodes by degree" && ffmpeg -y -i /tmp/t.aiff -ar 16000 -ac 1 -c:a pcm_s16le /tmp/t.wav`.

## Where things are

| | |
|---|---|
| Session | `../asdf10k-agentic-sessions/<id>/` - `meta.json` (status, sdkSessionId, graphHash, catalogHash), `events.jsonl` (+ `.seq`), `workspace/` |
| Agent cwd | `workspace/`: `input/` (nodes.tsv, edges.tsv, selection.tsv, subset_library.tsv, app_context.json), `out/` (what the agent wrote), `.claude/skills/asdf10k-app-catalog/SKILL.md` (generated) |
| SDK transcript | `~/.claude/projects/-Users-...-asdf10k-agentic-sessions-<id>-workspace/<sdkSessionId>.jsonl` |
| Agent process | `ps -axo pid,ppid,etime,command \| grep claude-agent-sdk-darwin`; `lsof -p <pid> -a -d cwd` -> which session |
| Models | `../asdf10k-agentic-models/ggml-*.bin` |

## Reading a session's log

```bash
python3 - ../asdf10k-agentic-sessions/<id> <<'EOF'
import sys, json, time
for line in open(f'{sys.argv[1]}/events.jsonl'):
    e = json.loads(line)
    if e['type'] in ('text_delta', 'status'): continue
    info = e.get('text') or e.get('label') or e.get('status') or e.get('message') or ''
    print(e['seq'], e['type'], e.get('runId'), f"{int(time.time() - e['ts'] / 1000)}s ago", str(info)[:80])
EOF
```

- A window spinner that never ends = a `run_start` without `run_end`. Since 2026-10-06 startup,
  shutdown, interrupt and the stall watchdog close such runs; if you see one, find out which of
  them did not fire.
- The answer text under the wrong user message = run ids collided (see CLAUDE.md pitfalls).
- "unknown command" / "not allowed" in a tool result = policy or catalog: the catalog is what the
  app last sent (`meta.catalogHash`, the generated skill in the workspace).
- Silence after a `tool_end` with the agent process at ~0 % CPU = the API request hangs; the
  watchdog stops it after `RUN_STALL_ABORT_MIN`; the SDK transcript shows the last message.

## Tests to extend

- `test/EventNormalizer*.test.ts` use the spike fixtures (`spike/fixtures/*.jsonl`); add a fixture
  when a new SDK message shape matters.
- `test/appCommandPolicy.test.ts` for policy changes, `test/catalogSkill.test.ts` for skill text
  that the agent depends on (block syntax, scope paragraph), `test/validate.test.ts` for the TSV
  and report rules.
