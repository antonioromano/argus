import { Router } from 'express';
import express from 'express';
import type { SessionManager } from '../services/SessionManager.js';
import type { AgentSignalState } from '@argus/shared';
import { verifySignalToken } from '../services/agentSignals/token.js';
import { isClaudeSessionId } from '../services/claudeSession.js';
import { isPlausibleTranscriptPath } from '../services/usage/SessionUsageTracker.js';

const VALID_STATES = new Set<AgentSignalState>(['running', 'waiting', 'idle']);

/** Loopback only — the daemon/CLI on this box is the sole legitimate caller. */
function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Native agent-signal ingestion (plan 2026-07-22-001). Hardened independently
 * of the bearer-auth middleware (it is mounted *before* that middleware so the
 * CLI can reach it without a UI token — R5): loopback-only socket, per-session
 * HMAC token, tiny body cap. The token is `HMAC(serverSecret, sessionId)` and
 * never appears in logs. `getSecret` is a closure so the secret is read once at
 * startup and never travels through config/state that reaches a client.
 */
/** The hook-side decider (AutoApprovalService.decide). */
export type PreToolUseDecider = (sessionId: string, hook: unknown) => object | null;

/** Body cap for a forwarded PreToolUse payload. A Write carries the whole file;
 *  anything over this (argus-signal caps a little below) gets no decision. */
export const PRE_TOOL_USE_BODY_LIMIT = '512kb';

export function createAgentSignalRoutes(
  manager: SessionManager,
  getSecret: () => string,
  decidePreToolUse?: PreToolUseDecider,
): Router {
  const router = Router();
  // Tiny dedicated cap — these payloads are a few fields of JSON.
  const smallJson = express.json({ limit: '16kb' });
  const hookJson = express.json({ limit: PRE_TOOL_USE_BODY_LIMIT });

  /**
   * F5: `argus-signal --approve` forwards the PreToolUse hook JSON and prints
   * whatever comes back. 200 + the hook output JSON means allow; 204 means
   * "say nothing" (Claude's normal permission flow). Same gate as the signal
   * route: loopback socket + per-session HMAC token. The session's folder and
   * agent come from the session table, not from the payload.
   */
  router.post('/:sessionId/pre-tool-use', hookJson, (req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const { sessionId } = req.params;
    const body = (req.body ?? {}) as { token?: unknown; hook?: unknown };
    if (typeof body.token !== 'string' || !verifySignalToken(getSecret(), sessionId, body.token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    let out: object | null = null;
    try {
      out = decidePreToolUse ? decidePreToolUse(sessionId, body.hook) : null;
    } catch (err) {
      console.warn('[autoApproval] decision failed:', err);
      out = null;
    }
    if (!out) {
      res.status(204).end();
      return;
    }
    res.status(200).type('application/json').send(JSON.stringify(out));
  });

  router.post('/:sessionId', smallJson, (req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const { sessionId } = req.params;
    const body = (req.body ?? {}) as {
      token?: unknown;
      state?: unknown;
      promptText?: unknown;
      coverage?: unknown;
      claudeSessionId?: unknown;
      transcriptPath?: unknown;
    };

    if (typeof body.token !== 'string' || !verifySignalToken(getSecret(), sessionId, body.token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Hook metadata (Claude session id + transcript path). Malformed values are
    // dropped, never rejected: the hook is fire-and-forget and a bad field must
    // not cost the state signal it rode in with.
    const claudeSessionId = isClaudeSessionId(body.claudeSessionId) ? body.claudeSessionId : undefined;
    const transcriptPath = isPlausibleTranscriptPath(body.transcriptPath) ? body.transcriptPath : undefined;
    const hasMeta = claudeSessionId !== undefined || transcriptPath !== undefined;
    if (hasMeta) manager.applyAgentMeta(sessionId, { claudeSessionId, transcriptPath });

    // State is optional only on a metadata-only post (Claude's SessionStart hook).
    if (body.state === undefined && hasMeta) {
      res.status(204).end();
      return;
    }
    if (typeof body.state !== 'string' || !VALID_STATES.has(body.state as AgentSignalState)) {
      res.status(400).json({ error: 'invalid state' });
      return;
    }

    const coverage = Array.isArray(body.coverage)
      ? (body.coverage.filter((c): c is AgentSignalState => VALID_STATES.has(c as AgentSignalState)))
      : undefined;

    // Fire-and-forget: unknown/exited sessions are silently ignored by the
    // manager, so the CLI never blocks on or retries a dead session.
    manager.applyNativeSignal(sessionId, {
      state: body.state as AgentSignalState,
      promptText: typeof body.promptText === 'string' ? body.promptText : undefined,
      coverage,
    });
    res.status(204).end();
  });

  return router;
}
