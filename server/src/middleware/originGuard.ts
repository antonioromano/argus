import type { IncomingMessage } from 'http';
import { isIP } from 'net';
import type { Request, Response, NextFunction } from 'express';

/**
 * Host/Origin gate for every HTTP request and Socket.io handshake.
 *
 * Without it the server trusted anything that reached 127.0.0.1: the `cors`
 * package only withholds response headers (the request still runs), and
 * engine.io never checks Origin on a WebSocket upgrade. So any page open in the
 * user's browser could `new WebSocket('ws://127.0.0.1:5757/socket.io/…')`, read
 * session ids off the status broadcasts and type into a shell (`ct:join` +
 * `ct:input`), and cross-site form POSTs reached the REST API.
 *
 * - Host must be loopback, an IP literal (ARGUS_HOST=0.0.0.0 LAN use), or the
 *   live tunnel host. DNS rebinding needs a domain name that resolves to us, so
 *   rejecting other names stops it.
 * - Origin, when present (browsers always send it cross-origin and on WS), must
 *   be a known client origin, the tunnel origin, or same-origin with an allowed
 *   Host. Requests with no Origin (curl, agent hooks) pass on the Host check.
 */
export interface OriginGuardOptions {
  /** Exact origins always allowed (renderer, Vite dev client, CORS_ORIGIN). */
  staticOrigins: string[];
  /** The live tunnel's public URL (e.g. https://x.ngrok.app), if any. */
  tunnelUrl: () => string | undefined;
}

export interface OriginGuard {
  check(headers: IncomingMessage['headers']): boolean;
  middleware(req: Request, res: Response, next: NextFunction): void;
  allowRequest(req: IncomingMessage, cb: (err: string | null | undefined, ok: boolean) => void): void;
}

/** Hostname of a Host header value: drops the port, unwraps `[::1]`. */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']')).toLowerCase();
  const colon = host.lastIndexOf(':');
  // A bare IPv6 literal has several colons and no port.
  if (colon !== -1 && host.indexOf(':') === colon) return host.slice(0, colon).toLowerCase();
  return host.toLowerCase();
}

function tunnelHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

export function createOriginGuard(opts: OriginGuardOptions): OriginGuard {
  const isAllowedHost = (host: string | undefined): boolean => {
    if (!host) return false;
    const name = hostnameOf(host);
    if (name === 'localhost' || isIP(name) !== 0) return true;
    const tunnel = tunnelHost(opts.tunnelUrl());
    return tunnel !== undefined && host.toLowerCase() === tunnel;
  };

  const isAllowedOrigin = (origin: string | undefined, host: string | undefined): boolean => {
    if (origin === undefined) return true;
    if (opts.staticOrigins.includes(origin)) return true;
    const tunnel = opts.tunnelUrl();
    if (tunnel && origin === tunnel) return true;
    let parsed: URL;
    try {
      parsed = new URL(origin); // 'null' (sandboxed iframes, file://) throws → rejected
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Same-origin with a Host we already trust (e.g. LAN IP with ARGUS_HOST).
    return host !== undefined && parsed.host.toLowerCase() === host.toLowerCase() && isAllowedHost(host);
  };

  const check = (headers: IncomingMessage['headers']): boolean => {
    const host = headers.host;
    const origin = typeof headers.origin === 'string' ? headers.origin : undefined;
    return isAllowedHost(host) && isAllowedOrigin(origin, host);
  };

  return {
    check,
    middleware(req, res, next) {
      if (check(req.headers)) {
        next();
        return;
      }
      res.status(403).json({ error: 'Forbidden: untrusted Host or Origin' });
    },
    allowRequest(req, cb) {
      cb(null, check(req.headers));
    },
  };
}
