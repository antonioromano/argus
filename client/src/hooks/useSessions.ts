import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionInfo, TerminalEngine, RunMode, ShellGitContext, SessionUsage, SessionStatusPayload, SessionPr } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/index.js';
import { pruneFileTreeCache } from './useFileTree.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SessionsUpdater = (prev: SessionInfo[]) => SessionInfo[];

/** What the user sees when the initial session list can't be fetched. The raw
 *  error ("Failed to fetch") says nothing about the cause, so it isn't shown. */
export function describeLoadError(err: unknown): string {
  // authFetch turns a rejected fetch into ApiError code SERVER_UNREACHABLE (plan 003).
  if (err instanceof TypeError || (err as { code?: unknown } | null)?.code === 'SERVER_UNREACHABLE') {
    return 'The Argus server isn’t responding. It may still be starting, or it stopped. Argus retries when the connection comes back.';
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return `The Argus server couldn’t return your sessions${detail}.`;
}

/** Previous run's exit info, carried across a snapshot that lacks it (the server doesn't persist exitCode yet). */
function keepExitInfo(snapshot: SessionInfo[], prev: SessionInfo[]): SessionInfo[] {
  const exited = new Map(prev.filter((s) => s.status === 'exited' && s.exitCode !== undefined).map((s) => [s.id, s]));
  if (exited.size === 0) return snapshot;
  return snapshot.map((s) => {
    const old = exited.get(s.id);
    if (!old || s.status !== 'exited' || s.exitCode !== undefined) return s;
    return { ...s, exitCode: old.exitCode, exitedAfterMs: old.exitedAfterMs };
  });
}

export function useSessions(socket: TypedSocket) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  // True once the initial REST fetch resolves. Consumers gate "session not
  // found" decisions on this so a restored focus view isn't dropped before the
  // list has loaded (Cmd+R focus persistence).
  const [loaded, setLoaded] = useState(false);
  // Set when the session list has never been fetched successfully (server
  // down or unreachable), so the shell can show the cause and a Retry instead
  // of the empty "Ready when you are" landing. Cleared by the next good fetch.
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRef = useRef<(() => void) | null>(null);
  // When this renderer last saw each session's agent (re)spawn: created here,
  // created elsewhere (socket), or restarted (status left 'exited'). Sessions
  // it never saw spawn fall back to createdAt.
  const spawnedAtRef = useRef(new Map<string, number>());
  // Mirror of `sessions` so rename can read the pre-edit name for rollback
  // without taking `sessions` as a dependency (which would churn the callback).
  const sessionsRef = useRef<SessionInfo[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Every incremental change (socket delta or local optimistic edit) goes
  // through applyDelta. While a REST snapshot is in flight the change is also
  // recorded, and replayed on top of the snapshot when it lands: the GET may
  // have been served before the change, and a bare setSessions(snapshot) would
  // roll it back (e.g. a session stuck "idle" while it runs, after reconnect).
  // All deltas are idempotent set/add/remove ops, so replaying one the snapshot
  // already contains is harmless.
  const pendingDeltasRef = useRef(new Set<SessionsUpdater[]>());
  const applyDelta = useCallback((fn: SessionsUpdater) => {
    for (const buf of pendingDeltasRef.current) buf.push(fn);
    setSessions(fn);
  }, []);

  // Evict per-session caches for sessions that are gone (deleted, errored, or
  // missing from a post-reconnect refetch). Gated on `loaded` so the empty
  // pre-fetch list never reads as "everything was deleted".
  useEffect(() => {
    if (!loaded) return;
    pruneFileTreeCache(new Set(sessions.map((s) => s.id)));
  }, [sessions, loaded]);

  // Load sessions on mount and after reconnect
  useEffect(() => {
    let started = 0;
    let appliedSeq = 0;
    const load = () => {
      const seq = ++started;
      const deltas: SessionsUpdater[] = [];
      pendingDeltasRef.current.add(deltas);
      return api.getSessions().then((snapshot) => {
        // A newer GET already landed; this response is older than it.
        if (seq < appliedSeq) return;
        appliedSeq = seq;
        setSessions((prev) => deltas.reduce((acc, fn) => fn(acc), keepExitInfo(snapshot, prev)));
      }).finally(() => {
        pendingDeltasRef.current.delete(deltas);
      });
    };

    // Only a list that was never loaded is an error: after a good load, a
    // failed reconnect fetch keeps showing the sessions already on screen.
    let everLoaded = false;
    const run = () => {
      load().then(() => {
        everLoaded = true;
        setLoadError(null);
        setLoaded(true);
      }, (err: unknown) => {
        console.error(err);
        if (!everLoaded) setLoadError(describeLoadError(err));
      });
    };
    loadRef.current = run;
    run();

    socket.on('connect', run);
    return () => {
      socket.off('connect', run);
      if (loadRef.current === run) loadRef.current = null;
    };
  }, [socket]);

  const retry = useCallback(() => { loadRef.current?.(); }, []);

  // Listen for socket events
  useEffect(() => {
    const handleStatus = ({ sessionId, status, lastPrompt, waitingSince, promptOptions }: SessionStatusPayload) => {
      // Leaving 'exited' means the agent was restarted: restart its clock.
      const respawned = status !== 'exited'
        && sessionsRef.current.find((s) => s.id === sessionId)?.status === 'exited';
      if (respawned) spawnedAtRef.current.set(sessionId, Date.now());
      applyDelta((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // waitingSince/promptOptions are only sent while waiting; their absence clears them.
          const next = { ...s, status, lastPrompt: lastPrompt ?? s.lastPrompt, waitingSince, promptOptions };
          if (status !== 'exited') { delete next.exitCode; delete next.exitedAfterMs; }
          return next;
        }),
      );
    };

    const handleExit = ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
      const now = Date.now();
      applyDelta((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const spawnedAt = spawnedAtRef.current.get(sessionId) ?? Date.parse(s.createdAt);
          const exitedAfterMs = Number.isFinite(spawnedAt) ? Math.max(0, now - spawnedAt) : undefined;
          return { ...s, status: 'exited' as const, exitCode, exitedAfterMs };
        }),
      );
    };

    const handleCreated = (session: SessionInfo) => {
      if (!spawnedAtRef.current.has(session.id)) spawnedAtRef.current.set(session.id, Date.now());
      applyDelta((prev) => {
        if (prev.some((s) => s.id === session.id)) return prev;
        return [...prev, session];
      });
    };

    const handleDeleted = ({ sessionId }: { sessionId: string }) => {
      spawnedAtRef.current.delete(sessionId);
      applyDelta((prev) => prev.filter((s) => s.id !== sessionId));
    };

    const handleSessionError = ({ sessionId }: { sessionId: string; message: string }) => {
      applyDelta((prev) => prev.filter((s) => s.id !== sessionId));
    };

    const handleRenamed = ({ sessionId, name }: { sessionId: string; name: string }) => {
      applyDelta((prev) => prev.map((s) => (s.id === sessionId ? { ...s, name } : s)));
    };

    const handleGitStatus = ({ sessionId, hasGitChanges }: { sessionId: string; hasGitChanges: boolean }) => {
      applyDelta((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, hasGitChanges } : s)),
      );
    };

    const handleShellContext = ({ sessionId, cwd, shellGit }: { sessionId: string; cwd: string; shellGit: ShellGitContext | null }) => {
      applyDelta((prev) => prev.map((s) => (s.id === sessionId ? { ...s, cwd, shellGit } : s)));
    };

    const handlePr = ({ sessionId, pr }: { sessionId: string; pr: SessionPr | null }) => {
      applyDelta((prev) => prev.map((s) => (s.id === sessionId ? { ...s, pr: pr ?? undefined } : s)));
    };

    const handleWorktreeStale = ({ sessionId, staleDays }: { sessionId: string; staleDays: number | null }) => {
      applyDelta((prev) => prev.map((s) => (s.id === sessionId ? { ...s, worktreeStaleDays: staleDays ?? undefined } : s)));
    };

    const handleUsage = ({ sessionId, usage }: { sessionId: string; usage: SessionUsage }) => {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, usage } : s)));
    };

    const handleClaudeId = ({ sessionId, claudeSessionId }: { sessionId: string; claudeSessionId: string }) => {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, claudeSessionId } : s)));
    };

    socket.on('session:status', handleStatus);
    socket.on('session:usage', handleUsage);
    socket.on('session:claudeId', handleClaudeId);
    socket.on('session:exit', handleExit);
    socket.on('session:created', handleCreated);
    socket.on('session:deleted', handleDeleted);
    socket.on('session:renamed', handleRenamed);
    socket.on('session:error', handleSessionError);
    socket.on('session:gitStatus', handleGitStatus);
    socket.on('session:shellContext', handleShellContext);
    socket.on('session:pr', handlePr);
    socket.on('session:worktreeStale', handleWorktreeStale);

    return () => {
      socket.off('session:status', handleStatus);
      socket.off('session:usage', handleUsage);
      socket.off('session:claudeId', handleClaudeId);
      socket.off('session:exit', handleExit);
      socket.off('session:created', handleCreated);
      socket.off('session:deleted', handleDeleted);
      socket.off('session:renamed', handleRenamed);
      socket.off('session:error', handleSessionError);
      socket.off('session:gitStatus', handleGitStatus);
      socket.off('session:shellContext', handleShellContext);
      socket.off('session:pr', handlePr);
      socket.off('session:worktreeStale', handleWorktreeStale);
    };
  }, [socket, applyDelta]);

  const createSession = useCallback(async (folderPath: string, name?: string, agentType?: string, flags?: string[], worktreeBranch?: string, worktreeBase?: string, terminalEngine?: TerminalEngine, runMode?: RunMode) => {
    const session = await api.createSession({ folderPath, name, agentType, flags, worktreeBranch, worktreeBase, terminalEngine, runMode });
    if (!spawnedAtRef.current.has(session.id)) spawnedAtRef.current.set(session.id, Date.now());
    applyDelta((prev) => {
      if (prev.some((s) => s.id === session.id)) return prev;
      return [...prev, session];
    });
    return session;
  }, [applyDelta]);

  /** Add a session created outside createSession (e.g. a beta F12 handoff) before its socket echo. */
  const adoptSession = useCallback((session: SessionInfo) => {
    applyDelta((prev) => (prev.some((s) => s.id === session.id) ? prev : [...prev, session]));
  }, [applyDelta]);

  // Optimistic: the name lands locally before the socket echo, so the surface
  // that just committed the edit never flickers back to the old label.
  const renameSession = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const previous = sessionsRef.current.find((s) => s.id === id)?.name;
    applyDelta((prev) => prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s)));
    try {
      await api.renameSession(id, trimmed);
    } catch (err) {
      if (previous !== undefined) {
        applyDelta((prev) => prev.map((s) => (s.id === id ? { ...s, name: previous } : s)));
      }
      pushToast(err instanceof Error ? err.message : 'Failed to rename shell', 'danger');
    }
  }, [applyDelta]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id);
      applyDelta((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete session', 'danger');
    }
  }, [applyDelta]);

  return { sessions, loaded, loadError, retry, createSession, adoptSession, deleteSession, renameSession };
}
