/**
 * HTTPS next to plain HTTP (README "Headsets / other devices"): with a certificate in `certs/`
 * (`npm run cert`, mkcert) the backend also listens on AGENT_HTTPS_PORT (default 8788). An HTTPS
 * app on a headset can then call the laptop directly - the headset accepts the certificate once by
 * opening the backend's /api/health and proceeding past the warning - instead of the Chrome flag
 * for an insecure origin. Plain HTTP stays on AGENT_PORT for the Vite proxy and localhost.
 */
import { existsSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

export interface TlsFiles {
  cert: Buffer;
  key: Buffer;
  /** Host names and IP addresses the certificate is valid for. */
  names: string[];
}

/** The certificate's subjectAltName entries (`DNS:a, IP Address:1.2.3.4`). */
export function certNames(subjectAltName: string | undefined): string[] {
  return (subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^(DNS|IP Address):/, ''))
    .filter(Boolean);
}

/** null without both files; throws when they exist but are not a certificate. */
export function loadTls(certFile: string, keyFile: string): TlsFiles | null {
  if (!existsSync(certFile) || !existsSync(keyFile)) return null;
  const cert = readFileSync(certFile);
  const key = readFileSync(keyFile);
  return { cert, key, names: certNames(new X509Certificate(cert).subjectAltName) };
}

/** LAN addresses the certificate does not cover (a new network: run `npm run cert` again). */
export function uncoveredAddresses(names: string[], addresses: string[]): string[] {
  const covered = new Set(names.map((n) => n.toLowerCase()));
  return addresses.filter((a) => !covered.has(a.toLowerCase()));
}
