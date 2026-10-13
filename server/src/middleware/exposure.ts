import type { IncomingHttpHeaders } from 'http';

/**
 * Per-request "is this reaching us from off the machine?" detection.
 *
 * `AuthService.exposed` only flips when Argus starts ngrok itself (or binds a
 * non-loopback ARGUS_HOST). A tunnel the user runs by hand — ngrok, cloudflared,
 * tailscale serve, an SSH -R forward behind a reverse proxy — dials 127.0.0.1, so
 * the socket looks local and auth stayed off. Proxies cannot avoid announcing
 * themselves, though: they add forwarding headers, or pass the public Host
 * through. Any such request is treated as exposed, so auth is enforced for it
 * (fail-closed 503 when no password is set) regardless of the global flag.
 *
 * Headers only ever make a request *stricter* here, so a client spoofing them
 * gains nothing.
 */

/** Forwarding headers a reverse proxy / tunnel adds. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip'];

/**
 * `ngrok-*` headers come from ngrok's edge — except this one, which our own
 * client sends on every fetch to skip ngrok's browser interstitial (api.ts), so
 * it must not mark a local request as exposed.
 */
const CLIENT_SET_NGROK_HEADERS = new Set(['ngrok-skip-browser-warning']);

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
}

/** True when the request carries any header a proxy or tunnel adds. */
export function hasProxyHeaders(headers: IncomingHttpHeaders): boolean {
  for (const name of Object.keys(headers)) {
    const n = name.toLowerCase();
    if (PROXY_HEADERS.includes(n)) return true;
    if (n.startsWith('ngrok-') && !CLIENT_SET_NGROK_HEADERS.has(n)) return true;
  }
  return false;
}

/** Hostname of a Host header value (port dropped, `[::1]` unwrapped). */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']')).toLowerCase();
  const colon = host.lastIndexOf(':');
  if (colon !== -1 && host.indexOf(':') === colon) return host.slice(0, colon).toLowerCase();
  return host.toLowerCase();
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = hostnameOf(host);
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/**
 * A request is exposed when it came from a non-loopback peer, carries proxy
 * headers, or names a non-loopback Host (LAN IP, tunnel domain). A missing Host
 * counts as exposed — fail closed.
 */
export function isExposedRequest(headers: IncomingHttpHeaders, remoteAddress: string | undefined): boolean {
  return !isLoopbackAddress(remoteAddress) || hasProxyHeaders(headers) || !isLoopbackHost(headers.host);
}
