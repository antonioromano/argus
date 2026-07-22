import { Router } from 'express';
import express from 'express';
import type { SessionManager } from '../services/SessionManager.js';
import type { AgentSignalState } from '@argus/shared';
import { verifySignalToken } from '../services/agentSignals/token.js';

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
export function createAgentSignalRoutes(
  manager: SessionManager,
  getSecret: () => string,
): Router {
  const router = Router();
  // Tiny dedicated cap — these payloads are a few fields of JSON.
  router.use(express.json({ limit: '16kb' }));

  router.post('/:sessionId', (req, res) => {
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
    };

    if (typeof body.token !== 'string' || !verifySignalToken(getSecret(), sessionId, body.token)) {
      res.status(401).json({ error: 'unauthorized' });
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
