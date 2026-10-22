---
name: start-backend
description: Start this agent backend for a hosted asdf10k app (e.g. "start the backend for https://app.example.org") and hand the user the ready-to-open app links with ?agent=, including the links for headsets / other devices on the same network and the one-time certificate step they need (HTTPS via mkcert). Use when the user asks to start, run or connect this backend for an app URL, a deployment, headsets, a Quest or a multiplayer session.
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
- **Other devices only:** a certificate for HTTPS (headsets cannot call `http://` from an HTTPS
  app). `certs/cert.pem` missing, or the log later warns that it does not cover the current LAN
  address: run `npm run cert` (needs `mkcert`: `brew install mkcert` on macOS; `mkcert -install`
  inside the script may ask for the password once - tell the user). Without mkcert and without
  a way to install it, fall back to the Chrome flag (step 4.2, "No certificate").
- Port free: also `lsof -iTCP:8788 -sTCP:LISTEN` when HTTPS is on.
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
2. **Other devices** (only with `0.0.0.0`): `<app URL>/?agent=https://<lan-ip>:8788/api` (the log's
   "Other devices" line), and on each device's browser, once:
   - open `https://<lan-ip>:8788/api/health`; the browser warns (the certificate is mkcert's,
     trusted on this laptop only): **Advanced -> Proceed**; JSON appears.
   - then open the app link. On a Quest, type the URL in Quest Browser's address bar.
   The exception lasts a while; when the Agent window later says "not reachable", repeat this.
   Instead of a link, the user can type `<lan-ip>` into the Agent window's backend strip and click
   Connect (the app fills in https and 8788; the strip links the certificate page when needed).
   **No certificate** (mkcert unavailable): `<app URL>/?agent=http://<lan-ip>:8787/api` plus, once
   per browser, `chrome://flags/#unsafely-treat-insecure-origin-as-secure` -> `http://<lan-ip>:8787`,
   Enabled, relaunch (Chromium browsers only; Safari has no such flag).
3. **Check from the other device:** the health page from step 2 must show JSON. If it does not
   load at all: the computer's firewall (macOS asks to allow incoming connections for `node`:
   allow), or the Wi-Fi isolates devices (common on guest / venue networks: use your own router or
   hotspot). A certificate error naming the address: run `npm run cert` again and restart.
4. **Keep the address fixed:** the links and the certificate contain the IP. A new network or DHCP
   lease means a new IP: `npm run cert`, restart, accept again, new links (a DHCP reservation or
   your own router avoids this).
5. **Multiplayer:** in a session, the Agent window's "Share live" (on by default) shows the agent
   session to the others read-only; each of them needs the certificate step from step 2. Their
   backend strip offers the backend this user is on ("<name> uses backend ... · Use it"), so a link
   is optional.
6. **Security:** no authentication - anyone on the network can use this backend (and the Claude
   account behind it). Only on networks you trust; stop it afterwards.

## 5. Stop

Stop the background process you started (or `pkill -f "tsx src/server.ts"`). Sessions stay on disk
in `SESSIONS_DIR` and resume next time.
