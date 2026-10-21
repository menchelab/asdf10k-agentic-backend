import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { connectHints, lanAddresses } from '../src/connectHints.js';

const iface = (address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: '', mac: '', cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) }) as NetworkInterfaceInfo;

const interfaces = {
  lo0: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
  en0: [iface('192.168.1.50', 'IPv4'), iface('fe80::1', 'IPv6')],
  bridge0: [iface('169.254.3.4', 'IPv4')]
};

describe('connectHints', () => {
  it('lists LAN IPv4 addresses only', () => {
    expect(lanAddresses(interfaces)).toEqual(['192.168.1.50']);
  });

  it('loopback: only the local URL', () => {
    const lines = connectHints({ host: '127.0.0.1', port: 8787, interfaces });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('?agent=http://localhost:8787/api');
  });

  it('all interfaces: one line per LAN address plus the flag hint', () => {
    const lines = connectHints({ host: '0.0.0.0', port: 8787, interfaces }).join('\n');
    expect(lines).toContain('?agent=http://192.168.1.50:8787/api');
    expect(lines).toContain('unsafely-treat-insecure-origin-as-secure');
    expect(lines).toContain('http://192.168.1.50:8787,');
  });

  it('AGENT_APP_URL makes full links', () => {
    const lines = connectHints({ host: '0.0.0.0', port: 8787, appUrl: 'https://app.example.org/', interfaces });
    expect(lines[1]).toContain('https://app.example.org/?agent=http://192.168.1.50:8787/api');
  });

  it('with the HTTPS port: https links for other devices and the accept-once step instead of the flag', () => {
    const lines = connectHints({ host: '0.0.0.0', port: 8787, httpsPort: 8788, appUrl: 'https://app.example.org', interfaces }).join('\n');
    expect(lines).toContain('?agent=http://localhost:8787/api');
    expect(lines).toContain('https://app.example.org/?agent=https://192.168.1.50:8788/api');
    expect(lines).toContain('https://192.168.1.50:8788/api/health');
    expect(lines).not.toContain('unsafely-treat-insecure-origin-as-secure');
  });
});
