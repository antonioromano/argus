import path from 'path';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { computeSignalToken, verifySignalToken } from '../agentSignals/token.js';

/** Name of the server inside the agent (`mcp__argus__start_session`, …). */
export const MCP_SERVER_NAME = 'argus';
export const MCP_PATH = '/mcp';
/** Header carrying the calling session's id; its bearer token is bound to it. */
export const MCP_SESSION_HEADER = 'x-argus-session';

// Domain-separated from the agent-signal token, so a leaked signal token
// (it sits in the agent's env) can't drive other sessions.
const scope = (sessionId: string) => `mcp:${sessionId}`;

export function computeMcpToken(secret: string, sessionId: string): string {
  return computeSignalToken(secret, scope(sessionId));
}

export function verifyMcpToken(secret: string, sessionId: string, token: string): boolean {
  return verifySignalToken(secret, scope(sessionId), token);
}

/** The `--mcp-config` document handed to one Claude session. */
export function mcpConfigFor(port: string, sessionId: string, token: string): object {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: `http://127.0.0.1:${port}${MCP_PATH}`,
        headers: { Authorization: `Bearer ${token}`, 'X-Argus-Session': sessionId },
      },
    },
  };
}

/**
 * Write the session's MCP config (mode 600, under the data dir — never the
 * session folder) and return the flags that load it. A file, not inline JSON:
 * the token stays off the agent's command line. Appended last, so the variadic
 * `--mcp-config` can't swallow anything after it; it adds to the user's own
 * MCP servers rather than replacing them.
 */
export function writeMcpConfig(dataDir: string, port: string, secret: string, sessionId: string): string[] {
  const dir = path.join(dataDir, 'mcp');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${sessionId}.json`);
  writeFileSync(file, JSON.stringify(mcpConfigFor(port, sessionId, computeMcpToken(secret, sessionId))), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best-effort hardening */ }
  return ['--mcp-config', file];
}
