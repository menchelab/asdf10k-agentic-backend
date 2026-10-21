import { describe, expect, it } from 'vitest';
import { certNames, loadTls, uncoveredAddresses } from '../src/tls.js';

describe('tls', () => {
  it('reads the subjectAltName entries', () => {
    expect(certNames('DNS:localhost, DNS:mac.local, IP Address:127.0.0.1, IP Address:192.168.1.50')).toEqual(['localhost', 'mac.local', '127.0.0.1', '192.168.1.50']);
    expect(certNames(undefined)).toEqual([]);
  });

  it('names the LAN addresses a certificate misses', () => {
    expect(uncoveredAddresses(['localhost', '192.168.1.50'], ['192.168.1.50', '10.0.0.7'])).toEqual(['10.0.0.7']);
  });

  it('no files: HTTPS off', () => {
    expect(loadTls('/nonexistent/cert.pem', '/nonexistent/key.pem')).toBeNull();
  });
});
