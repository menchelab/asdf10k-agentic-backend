---
name: start-backend
description: Start this agent backend for a hosted asdf10k app (e.g. "start the backend for https://app.example.org") and hand the user the ready-to-open app links with ?agent=, including the links for headsets / other devices on the same network and the Chrome flag they need. Use when the user asks to start, run or connect this backend for an app URL, a deployment, headsets, a Quest or a multiplayer session.
---

# Start the backend for a hosted app

Goal: the user (and possibly headsets or other devices on the same Wi-Fi) opens the hosted app with
`?agent=<this backend>/api` and the Agent window works. Background: README "Connecting the app".

## 1. Inputs

- **App URL** from the request (e.g. `https://app.example.org`). None given: start anyway and print
  bare `?agent=` parameters the user appends to the app's address.
- **Other devices?** If the user mentions headsets, a Quest, phones, other people, a multiplayer
  session or "the network", the backend must listen on all interfaces (`AGENT_HOST=0.0.0.0`).
  Otherwise ask once: "Only this computer's browser, or other devices on your network too?"
  Default without an answer: this computer only (`127.0.0.1`; the backend has no authentication).

## 2. Preconditions (fix what is missing, say what you did)

- `node_modules/` exists, else `npm install`.
- Claude access: a Claude Code login on this machine or `ANTHROPIC_API_KEY` in `.env` (README
  "Claude access"). Without either, start with `AGENT_FAKE=1` only if the user wants a demo without
  Claude calls - say so plainly.
- Port free: `lsof -iTCP:8787 -sTCP:LISTEN` (macOS / Linux). Already running from this repo: reuse
  it if its host setting fits, else stop it and restart.
- Optional: `npm run setup:python` once (the agent's Python tools); `/health` reports `python`.

## 3. Start it

Run in the background (keep it running after your turn), from this repo:

```
AGENT_HOST=<127.0.0.1 or 0.0.0.0> AGENT_APP_URL=<app URL> npm start
```

Then poll `curl -s http://localhost:8787/api/health` until it answers (a few seconds). The start-up
log prints the links (`src/connectHints.ts`): "App on this machine: ..." and, with `0.0.0.0`,
"Other devices (same network): ..." per network address. Use those lines; do not build URLs by hand
unless the log is unavailable. The LAN address can be checked with `ipconfig getifaddr en0` (macOS),
`hostname -I` (Linux) or `ipconfig` (Windows).

## 4. Tell the user (short, copyable)

1. **This computer:** `<app URL>/?agent=http://localhost:8787/api` - works from an HTTPS app;
   Chrome may ask once to allow local network access: allow it.
2. **Other devices** (only with `0.0.0.0`): `<app URL>/?agent=http://<lan-ip>:8787/api`, and on each
   device's browser, once:
   - open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - enter `http://<lan-ip>:8787`, set the flag to Enabled, relaunch the browser.
   This lets the HTTPS app call the laptop's plain-HTTP backend (otherwise the browser blocks it as
   mixed content). Chromium-based browsers (Chrome, Edge, Quest Browser) have the flag; Safari does
   not. On a Quest, type the URL in Quest Browser's address bar.
3. **Check from the other device:** opening `http://<lan-ip>:8787/api/health` there must show JSON.
   If not: the computer's firewall (macOS asks to allow incoming connections for `node`: allow), or
   the Wi-Fi isolates devices (common on guest / venue networks: use your own router or hotspot).
4. **Keep the address fixed:** the flag and the links contain the IP. A new network or DHCP lease
   means a new IP: redo the flag entry and use the new links (a DHCP reservation or your own router
   avoids this).
5. **Multiplayer:** in a session, the Agent window's "Share live" (on by default) shows the agent
   session to the others read-only; each of them needs the link and flag from step 2.
6. **Security:** no authentication - anyone on the network can use this backend (and the Claude
   account behind it). Only on networks you trust; stop it afterwards.

## 5. Stop

Stop the background process you started (or `pkill -f "tsx src/server.ts"`). Sessions stay on disk
in `SESSIONS_DIR` and resume next time.
