import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { handleRpc, RPC, type ToolDef } from '../services/mcp/protocol.js';
import type { McpCaller } from '../services/mcp/tools.js';
import { MCP_SESSION_HEADER, verifyMcpToken } from '../services/mcp/injection.js';

export interface McpRouteDeps {
  /** AppConfig.mcpServerEnabled — off answers 404, as if there were no route. */
  isEnabled(): boolean;
  getSecret(): string;
  /** The live session behind a verified token; undefined for an unknown id. */
  caller(sessionId: string): McpCaller | undefined;
  tools: readonly ToolDef<McpCaller>[];
  /** SSE keep-alive period while a tool call (an approval) is pending. */
  keepAliveMs?: number;
}

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/**
 * The Argus MCP server (F10), Streamable HTTP at /mcp. Mounted before the
 * bearer-auth middleware, like agent signals, and hardened on its own terms:
 * loopback socket, loopback Host, no browser Origin, no proxy (an ngrok
 * tunnel also dials loopback, but adds X-Forwarded-For), and a per-session
 * HMAC token bound to the X-Argus-Session id. Only sessions Argus spawned
 * with the setting on hold such a token, so the caller is always a known session.
 */
/** Body cap: a start_session prompt (10k chars) plus JSON-RPC framing, with headroom. */
export const MCP_BODY_LIMIT = '256kb';

export function createMcpRoutes(deps: McpRouteDeps): Router {
  const router = Router();
  const keepAliveMs = deps.keepAliveMs ?? 20_000;
  // Own parser (bodyParsers SELF_PARSED skips /mcp), run only after authorize:
  // nobody gets a body parsed without a token, and bad JSON is a JSON-RPC error.
  const json = express.json({ limit: MCP_BODY_LIMIT });
  const parseError = (res: Response) =>
    res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: RPC.parseError, message: 'Expected a JSON-RPC body' } });

  const authorize = (req: Request, res: Response): McpCaller | undefined => {
    if (!deps.isEnabled()) { res.status(404).json({ error: 'not found' }); return undefined; }
    if (
      !isLoopback(req.socket.remoteAddress) || !LOOPBACK_HOST.test(req.headers.host ?? '') ||
      req.headers.origin !== undefined || req.headers['x-forwarded-for'] !== undefined
    ) {
      res.status(403).json({ error: 'forbidden' });
      return undefined;
    }
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const sessionId = req.headers[MCP_SESSION_HEADER];
    const caller = typeof sessionId === 'string' && token && verifyMcpToken(deps.getSecret(), sessionId, token)
      ? deps.caller(sessionId)
      : undefined;
    if (!caller) { res.status(401).json({ error: 'unauthorized' }); return undefined; }
    return caller;
  };

  router.post('/', (req, res) => {
    const caller = authorize(req, res);
    if (!caller) return;
    if (!req.is('application/json')) { parseError(res); return; }
    json(req, res, (err?: unknown) => {
      if (err) { parseError(res); return; }
      respond(req, res, caller);
    });
  });

  const respond = (req: Request, res: Response, caller: McpCaller) => {
    const msg: unknown = req.body;
    const isToolCall = !!msg && typeof msg === 'object' && (msg as { method?: unknown }).method === 'tools/call';
    // A tool call can wait minutes for the user's approval. Over plain JSON an
    // HTTP client may give up waiting for headers; as an SSE stream the headers
    // go out at once and a comment every few seconds keeps the body alive.
    const stream = isToolCall && /text\/event-stream/.test(req.headers.accept ?? '');
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    // The client hung up before the answer: tell the tool (a pending launch
    // card is withdrawn) and stop writing keep-alives to a dead socket.
    const aborter = new AbortController();
    res.on('close', () => {
      if (keepAlive) clearInterval(keepAlive);
      if (!res.writableFinished) aborter.abort();
    });
    if (stream) {
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders();
      keepAlive = setInterval(() => res.write(': keep-alive\n\n'), keepAliveMs);
      keepAlive.unref?.();
    }
    handleRpc(msg, deps.tools, { ...caller, signal: aborter.signal })
      .then((out) => {
        if (stream) {
          if (out) res.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
          res.end();
        } else if (out) {
          res.status(200).json(out);
        } else {
          res.status(202).end();
        }
      })
      .catch((err) => {
        console.warn('[mcp] request failed:', err);
        const out = { jsonrpc: '2.0', id: null, error: { code: RPC.internal, message: 'Internal error' } };
        if (stream) res.end(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
        else res.status(500).json(out);
      })
      .finally(() => { if (keepAlive) clearInterval(keepAlive); });
  };

  // Stateless server: no server-initiated stream to open, no session to end.
  router.all('/', (_req, res) => {
    if (!deps.isEnabled()) { res.status(404).json({ error: 'not found' }); return; }
    res.status(405).set('Allow', 'POST').json({ error: 'method not allowed' });
  });

  return router;
}
