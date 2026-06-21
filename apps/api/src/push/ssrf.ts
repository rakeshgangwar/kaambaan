/**
 * SSRF allowlist for outbound push urls (docs/05 §4). Accept only public http(s) endpoints — reject
 * localhost, loopback, private (RFC1918), link-local (incl. 169.254 cloud metadata), and IPv6
 * loopback/link-local/ULA literals. NOTE: a register-time literal-IP check does NOT stop DNS
 * rebinding; the durable fix is host-allowlist / ownership-verification before production.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;

  if (host.includes(':')) {
    // IPv6 literal: loopback (::1), unspecified (::), link-local (fe80::/10), ULA (fc00::/7).
    if (host === '::1' || host === '::') return false;
    if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
    return true;
  }

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 169 && b === 254) return false; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT (100.64/10)
  }
  return true;
}
