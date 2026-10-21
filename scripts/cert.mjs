#!/usr/bin/env node
/**
 * `npm run cert`: a certificate for the backend's HTTPS port (src/tls.ts) made with mkcert, valid
 * for localhost, this machine's name and its current LAN addresses. Run again after joining another
 * network (the start-up log warns when an address is not covered). Files: certs/cert.pem, key.pem
 * (git-ignored).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'certs');

const has = (cmd) => {
  try {
    execFileSync(cmd, ['-help'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return e.code !== 'ENOENT';
  }
};
if (!has('mkcert')) {
  console.error('mkcert is not installed: macOS `brew install mkcert`, Linux https://github.com/FiloSottile/mkcert#installation, Windows `choco install mkcert`.');
  process.exit(1);
}

const lan = [];
for (const list of Object.values(networkInterfaces())) {
  for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) lan.push(i.address);
}
const host = hostname().replace(/\.local$/, '');
const names = [...new Set(['localhost', '127.0.0.1', '::1', host, `${host}.local`, ...lan])];

mkdirSync(dir, { recursive: true });
// -install puts mkcert's CA into this machine's trust store (asks for the password once): this
// machine's browsers then trust the backend; headsets accept it once instead (README)
execFileSync('mkcert', ['-install'], { stdio: 'inherit' });
execFileSync('mkcert', ['-cert-file', resolve(dir, 'cert.pem'), '-key-file', resolve(dir, 'key.pem'), ...names], { stdio: 'inherit' });
console.log(`\ncerts/cert.pem for: ${names.join(', ')}\nStart the backend (AGENT_HOST=0.0.0.0 npm start): it serves HTTPS on AGENT_HTTPS_PORT (default 8788) too.`);
