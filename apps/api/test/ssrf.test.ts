import { describe, it, expect } from 'vitest';
import { isPublicHttpUrl } from '../src/push/ssrf';

/** docs/05 §4: outbound push urls must be public http(s) — block SSRF to internal/metadata hosts. */
describe('isPublicHttpUrl', () => {
  it('accepts public http(s) urls', () => {
    expect(isPublicHttpUrl('https://agent.example.com/hook')).toBe(true);
    expect(isPublicHttpUrl('http://example.com:8080/x')).toBe(true);
    expect(isPublicHttpUrl('https://1.2.3.4/h')).toBe(true);
    expect(isPublicHttpUrl('https://172.32.0.1/h')).toBe(true); // just outside 172.16/12
  });

  it('rejects non-http(s) schemes and unparseable input', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('ftp://h/x')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });

  it('rejects localhost and loopback', () => {
    expect(isPublicHttpUrl('http://localhost/x')).toBe(false);
    expect(isPublicHttpUrl('http://foo.localhost/x')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/x')).toBe(false);
  });

  it('rejects private and link-local ranges (incl. cloud metadata)', () => {
    expect(isPublicHttpUrl('http://10.0.0.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://172.31.255.255/x')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/x')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isPublicHttpUrl('http://0.0.0.0/x')).toBe(false);
    expect(isPublicHttpUrl('http://[fe80::1]/x')).toBe(false);
    expect(isPublicHttpUrl('http://[fc00::1]/x')).toBe(false);
  });
});
