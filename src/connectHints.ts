/**
 * Start-up lines that tell the user how to point the app at this backend: the app's `?agent=` URL
 * parameter (the backend base URL including `/api`). Listening on all interfaces, one line per LAN
 * address (headsets / other devices on the network; README "Connecting the app"); else the
 * loopback URL, which an HTTPS app on the same machine may call too. With the HTTPS port (src/tls.ts)
 * the other devices get `https://` links and accept the certificate once (open /api/health,
 * proceed past the warning) instead of the Chrome insecure-origin flag.
 */
import type { NetworkInterfaceInfo } from 'node:os';

export interface ConnectHintInput {
  host: string;
  port: number;
  /** The HTTPS port when a certificate is loaded (src/tls.ts). */
  httpsPort?: number | undefined;
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

const hostPart = (h: string): string => (h.includes(':') ? `[${h}]` : h);

export function connectHints({ host, port, httpsPort, appUrl, interfaces }: ConnectHintInput): string[] {
  const local = `http://localhost:${port}/api`;
  if (LOOPBACK.has(host)) {
    return [`App on this machine: ${link(appUrl, local)}  (AGENT_HOST=0.0.0.0 for other devices)`];
  }
  const hosts = ALL.has(host) ? lanAddresses(interfaces) : [host];
  const lines = [`App on this machine: ${link(appUrl, local)}`];
  if (httpsPort) {
    for (const h of hosts) lines.push(`Other devices (same network): ${link(appUrl, `https://${hostPart(h)}:${httpsPort}/api`)}`);
    if (hosts.length) {
      lines.push(`  Each device's browser, once: open ${hosts.map((h) => `https://${hostPart(h)}:${httpsPort}/api/health`).join(' or ')}, Advanced -> Proceed (the certificate is mkcert's, not public).`);
      lines.push('  No authentication: trusted networks only.');
    }
    return lines;
  }
  for (const h of hosts) {
    const backend = `http://${hostPart(h)}:${port}`;
    lines.push(`Other devices (same network): ${link(appUrl, `${backend}/api`)}`);
  }
  if (hosts.length) {
    lines.push('  An HTTPS app on another device cannot call http:// - `npm run cert` (mkcert) and a restart give an HTTPS port; or, once per browser:');
    lines.push(`  chrome://flags/#unsafely-treat-insecure-origin-as-secure -> ${hosts.map((h) => `http://${hostPart(h)}:${port}`).join(', ')}, enable, relaunch. No authentication: trusted networks only.`);
  }
  return lines;
}
