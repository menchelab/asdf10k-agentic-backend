# Changelog

Every commit of every release, newest first.

## 0.4.0 (2026-10-21)

2 commits.

- CORS: allow Content-Encoding (the app uploads the graph gzip-compressed): a cross-origin ?agent= backend (laptop over HTTPS or the insecure-origin flag) failed the first message's preflight (ec5c07b)
- HTTPS for headsets: npm run cert (mkcert: localhost, host name, LAN addresses -> certs/, git-ignored) and a second listener on AGENT_HTTPS_PORT (8788) when the certificate exists; HTTP stays on 8787 (Vite proxy, localhost). Start-up hints give other devices https:// links and the accept-once step (open /api/health, Advanced -> Proceed) instead of the Chrome insecure-origin flag (kept as the no-certificate fallback); a warning when a LAN address is not in the certificate. AGENT_TLS_CERT / AGENT_TLS_KEY; tests; README, skill, architecture (22e166e)

## 0.3.0 (2026-10-21)

3 commits.

- Dataset description in the system prompt: the app sends the dataset's data_description.txt with a message when its hash changes (dataDescription, meta dataDescriptionHash); stored as input/data_description.txt, appended to the system prompt at every agent start; a change restarts an idle agent (resume); tests; docs (9f01459)
- Start-up hints: print the app's ?agent= links (this machine; per LAN address with AGENT_HOST=0.0.0.0, plus the Chrome insecure-origin flag); AGENT_APP_URL makes them full links; start-backend skill (start for an app URL, hand out links and browser setup); README: laptop setups, mixed-content exceptions (83ac99b)
- Protocol 2 (app plan C3): catalog commands carry presentation (direct / card / button), settings their scope, the empty actions list is gone; the run_app_command policy and the catalog skill read them (protocol 1 catalogs derived from effect as before); app results may carry txIds (e3313b8)

## 0.2.0 (2026-10-16)

5 commits.

- README: network setup also via server.py --backend (55d1f2c)
- README: one-machine setup uses the deployment's server.py proxy (no agentBackendUrl); AGENT_HOST in the network row (11fdd00)
- Listen settings AGENT_HOST / AGENT_PORT instead of HOST / PORT (conda sets HOST to a platform triple, the backend failed to start); invalid values warn and fall back to 127.0.0.1:8787; docs (179f933)
- README: HTTPS rule precise (headsets via localhost are fine) (345ff7d)
- README for people and agents who deploy it: security note, quick start, connecting the app (three setups, mixed content, SSE / upload proxy settings, nginx and Caddy), Claude access (login or API key), settings table, voice model, running as a service, troubleshooting; listen on 127.0.0.1 by default (HOST to open it), .env.example (58266d7)

## 0.1.0 (2026-10-16)

26 commits.

- MIT license, npm run release (version bump, CHANGELOG with every commit, tag, push, GitHub release via gh), repository field; README and CLAUDE.md: the repo is public, releases (0f55072)
- Development moves to the public repo menchelab/asdf10k-agentic-backend: drop the snapshot publish script (0d24fa8)
- publish-public: drop the publish:public npm script from the public package.json (558328d)
- scripts/publish-public.sh: the public snapshot script (1833215)
- Public snapshot: scripts/publish-public.sh (npm run publish:public) exports HEAD to menchelab/asdf10k-agentic-backend with scrubbed spike fixtures (local paths, connector names) and a fresh history; README stands on its own (what it is, wwiznet_dist, how the app reaches it) (1406d16)
- Prompt: scope - app tools for what the app does, own Python analysis and web lookups for the rest, offer next steps; ring actions as commands in the skill, tool text, policy, tests and docs (f5c74b1)
- Policy: a ring menu id used as a command gets a hint (subset.action / menu.run / settings card); skill says so (2336e7b)
- Faster defaults: session agent on Sonnet 5.5 at medium effort (AGENT_MODEL / AGENT_EFFORT), the What's up side query on Haiku 4.5 at low effort (ASIDE_MODEL); README section Model and speed, .env.example (70ec087)
- Prompt: audience (biologists and bioinformaticians, their network datasets, their vocabulary) and concrete answer-length rules (result first, at most 6 sentences or 5 bullets plus one table / card / chip, no preamble, no closing offers, numbers in tables, no step narration, reports for anything longer than a screen) (5f5e717)
- asdf10k-app skill: link parameters are the command's own (type=, the catalog's option keys) (cc7062e)
- CLAUDE.md points to the app's handover doc for phase 5 (4e6117f)
- Agent-facing docs: CLAUDE.md (commands, rules, pitfalls, related repos), docs/architecture.md (modules, path of a message, lifecycle, tools and policy, API, events), docs/sdk-notes.md, docs/testing.md (checks, curl recipes, where files are, reading a log), docs/README.md index; README points to them (337bfd2)
- Runs that lose their agent are ended: shutdown and startup append an error + run_end to open runs (also for sessions marked interrupted / error earlier), interrupt without a live agent does the same; stall watchdog (status waiting after RUN_STALL_WARN_S, stop after RUN_STALL_ABORT_MIN); POST /sessions/:id/aside runs a forked one-turn side query ('What's up?') and logs an aside event; session meta writes serialised per session (init and run_start raced and dropped sdkSessionId, so sessions resumed without history) and lost ids recovered from the log at startup; prompt: BigBrainz20k identity, RWR edge flow column for edge colour / width, one chip per node set, no topN by default; README, .env.example (5bb197f)
- Voice input: POST /transcribe runs whisper.cpp (whisper-cli, best ggml model in WHISPER_MODELS_DIR, large-v3-turbo-q8_0 recommended), /health reports transcribe availability; run ids continue after the run_start events already in the log (a session re-opened after a restart reused r1 and its answer landed in the old run block); Bash step labels: description or summarizeCommand fallback, prompt asks for a 3-8 word description; catalog marks required window options, prompt asks for a window's column and short chip names; .env.example and README (voice input, model choice); tests (dce3cab)
- View changes are cards, not tool calls: policy refuses settings.set / window.open / window.configure / window.close in run_app_command with a hint to write a card; feedback keeps proposalId / outcome / data (card state for replay); open windows carry ids in the app context (type#id); catalog skill and asdf10k-app skill explain settings and window cards (block = do, link = offer, Revert on every card, configure by id or newest of a type), prompt updated; fake agent shows a window card; tests (6ed947a)
- Catalog skill: read-only marker and a paragraph on the highlight mode (what it is, where the user changes it); prompt, asdf10k-app skill and README say highlight.* is read-only for the agent; test (2cabece)
- Catalog skill: 'what it does' columns for settings and actions, scope paragraph (G / S toggle, useGlobal, subset-only windows) before the windows table; prompt and asdf10k-app skill: auto-accepted / reverted settings cards, window scope; test (d097c15)
- Protocol: optional description on catalog settings and actions (b96c605)
- Phase 4 step 4: prompt and asdf10k-app skill describe window.open (flat options, catalog scope / options, button vs. run); README: phase 4 section (catalog skill, run_app_command policy, viz in the snapshot) (dd3f6b3)
- Phase 4 step 2: run_app_command tool (policy: view and compute commands only), app_request event and app-results endpoint with a 120 s wait, catalog kept per session, prompt and skill text for rwr.run / cluster.run / settings.set (1ec0e81)
- Phase 4 step 1: generated skill asdf10k-app-catalog from the app catalog (rewritten when its hash changes, skills reloaded), viz settings line in the app context, prompt and skill text for settings.set and settings cards, fake agent with a settings card (d198f17)
- Step labels: Bash steps show the command's description without a 'Bash:' prefix (normaliser and fake agent) (2cf753a)
- Phase 3: MCP tools propose_node_columns (TSV validation against the uploaded graph) and publish_report (front matter, roles, files), proposal / report / feedback events, feedback endpoint prefixed to the next prompt, system prompt and skills for markdown actions and reports (asdf10k-reports), fake agent with cards, tests (212a800)
- Phase 2: graph upload (PUT /sessions/:id/graph, gzip), app snapshot -> input files + <app_context> block before every message, system prompt, skills asdf10k-columns and asdf10k-app, Python env (uv), python flag in /health, tests (da41afb)
- Phase 1: Hono API with sessions, live query per session (idle close, resume), event log with restart-safe seq and SSE replay, EventNormalizer (per-block assistant messages, task tools, interrupt), fake agent, tests (5849218)
- Phase 0 spike: Agent SDK in streaming input mode (skills from workspace and additionalDirectories, in-process MCP tool, task tools, Bash under bypass, interrupt, resume), recorded message fixtures and findings (1691a77)
