/**
 * Start-up lines that tell the user how to point the app at this backend: the app's `?agent=` URL
 * parameter (the backend base URL including `/api`). Listening on all interfaces, one line per LAN
 * address (headsets / other devices on the network; README "Connecting the app"); else the
 * loopback URL, which an HTTPS app on the same machine may call too.
 */
import type { NetworkInterfaceInfo } from 'node:os';

export interface ConnectHintInput {
  host: string;
  port: number;
  /** AGENT_APP_URL: the app's address; makes the lines full links. */
  appUrl?: string | undefined;
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
}

const ALL = new Set(['0.0.0.0', '::']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** IPv4 addresses other devices can reach (no loopback, no link-local). */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const out: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
    }
  }
  return out;
}

function link(appUrl: string | undefined, backend: string): string {
  const param = `?agent=${backend}`;
  if (!appUrl) return param;
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/${param}`;
}

export function connectHints({ host, port, appUrl, interfaces }: ConnectHintInput): string[] {
  const local = `http://localhost:${port}/api`;
  if (LOOPBACK.has(host)) {
    return [`App on this machine: ${link(appUrl, local)}  (AGENT_HOST=0.0.0.0 for other devices)`];
  }
  const hosts = ALL.has(host) ? lanAddresses(interfaces) : [host];
  const lines = [`App on this machine: ${link(appUrl, local)}`];
  for (const h of hosts) {
    const backend = `http://${h.includes(':') ? `[${h}]` : h}:${port}`;
    lines.push(`Other devices (same network): ${link(appUrl, `${backend}/api`)}`);
  }
  if (hosts.length) {
    lines.push('  An HTTPS app on another device needs, once per browser: chrome://flags/#unsafely-treat-insecure-origin-as-secure');
    lines.push(`  -> ${hosts.map((h) => `http://${h.includes(':') ? `[${h}]` : h}:${port}`).join(', ')}, enable, relaunch. No authentication: trusted networks only.`);
  }
  return lines;
}
