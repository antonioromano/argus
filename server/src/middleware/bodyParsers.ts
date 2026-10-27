import express from 'express';
import type { Request, RequestHandler } from 'express';

/** Default JSON body cap for every API route that doesn't set its own. Every
 *  REST payload is a few KB (patch selections, commit file lists, config);
 *  1 MB leaves ample headroom. Was 10 MB app-wide. */
export const DEFAULT_JSON_LIMIT = '1mb';

/**
 * Routes that mount their own body parser with their own limit. The app-wide
 * parser MUST skip them: body-parser does nothing once a body has been parsed,
 * so when the global parser ran first (as it did, at 10 MB) the route's own
 * limit silently never applied.
 */
const SELF_PARSED: ReadonlyArray<{ method?: string; path: string; prefix?: true }> = [
  { method: 'PUT', path: '/api/fs/file' }, // editor save — 2 MB (routes/filesystem.ts)
  { path: '/api/agent-signals', prefix: true }, // CLI/daemon signals — 16 KB, PreToolUse 512 KB (routes/agentSignals.ts)
  { path: '/api/debug/scroll', prefix: true }, // dev-only text sink — 1 MB (routes/debugScroll.ts)
  { path: '/mcp', prefix: true }, // MCP server — parsed after its auth check, 256 KB (routes/mcp.ts)
];

export function parsesOwnBody(req: Pick<Request, 'method' | 'path'>): boolean {
  return SELF_PARSED.some((r) =>
    (r.method === undefined || r.method === req.method) &&
    (r.prefix ? req.path === r.path || req.path.startsWith(r.path + '/') : req.path === r.path));
}

/** App-wide JSON parser that leaves self-parsing routes to their own limits. */
export function createJsonBodyParser(limit: string = DEFAULT_JSON_LIMIT): RequestHandler {
  const json = express.json({ limit });
  return (req, res, next) => {
    if (parsesOwnBody(req)) {
      next();
      return;
    }
    json(req, res, next);
  };
}
