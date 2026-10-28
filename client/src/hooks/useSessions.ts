import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionInfo, TerminalEngine, RunMode, ShellGitContext, SessionUsage, SessionStatusPayload, SessionPr } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/index.js';
import { pruneFileTreeCache } from './useFileTree.js';
import { pruneChatDrafts } from '../app/ui/chat/chatDrafts.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SessionsUpdater = (prev: SessionInfo[]) => SessionInfo[];

export function useSessions(socket: TypedSocket) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  // True once the initial REST fetch resolves. Consumers gate "session not
  // found" decisions on this so a restored focus view isn't dropped before the
  // list has loaded (Cmd+R focus persistence).
  const [loaded, setLoaded] = useState(false);
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
  // Drafts are user text, not a cache: only a list the server actually sent
  // may drop them (`loaded` is also set when the first GET failed).
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const live = new Set(sessions.map((s) => s.id));
    pruneFileTreeCache(live);
    if (fetchedRef.current) pruneChatDrafts(live);
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
        fetchedRef.current = true;
        setSessions(() => deltas.reduce((acc, fn) => fn(acc), snapshot));
      }).finally(() => {
        pendingDeltasRef.current.delete(deltas);
      });
    };

    load().catch(console.error).finally(() => setLoaded(true));

    const handleReconnect = () => {
      load().catch(console.error);
    };
    socket.on('connect', handleReconnect);
    return () => { socket.off('connect', handleReconnect); };
  }, [socket]);

  // Listen for socket events
  useEffect(() => {
    const handleStatus = ({ sessionId, status, lastPrompt, waitingSince, promptOptions, promptQuestion, promptTabs }: SessionStatusPayload) => {
      applyDelta((prev) =>
        prev.map((s) => (s.id === sessionId
          // waitingSince/promptOptions/promptQuestion/promptTabs are only sent while waiting; their absence clears them.
          ? { ...s, status, lastPrompt: lastPrompt ?? s.lastPrompt, waitingSince, promptOptions, promptQuestion, promptTabs }
          : s)),
      );
    };

    const handleExit = ({ sessionId }: { sessionId: string; exitCode: number }) => {
      applyDelta((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'exited' as const } : s)),
      );
    };

    const handleCreated = (session: SessionInfo) => {
      applyDelta((prev) => {
        if (prev.some((s) => s.id === session.id)) return prev;
        return [...prev, session];
      });
    };

    const handleDeleted = ({ sessionId }: { sessionId: string }) => {
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

  return { sessions, loaded, createSession, adoptSession, deleteSession, renameSession };
}
