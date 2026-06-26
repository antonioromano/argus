import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/index.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSessions(socket: TypedSocket) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  // True once the initial REST fetch resolves. Consumers gate "session not
  // found" decisions on this so a restored focus view isn't dropped before the
  // list has loaded (Cmd+R focus persistence).
  const [loaded, setLoaded] = useState(false);

  // Load sessions on mount and after reconnect
  useEffect(() => {
    api.getSessions().then(setSessions).catch(console.error).finally(() => setLoaded(true));

    const handleReconnect = () => {
      api.getSessions().then(setSessions).catch(console.error);
    };
    socket.on('connect', handleReconnect);
    return () => { socket.off('connect', handleReconnect); };
  }, [socket]);

  // Listen for socket events
  useEffect(() => {
    const handleStatus = ({ sessionId, status, lastPrompt }: { sessionId: string; status: SessionStatus; lastPrompt?: string }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status, lastPrompt: lastPrompt ?? s.lastPrompt } : s)),
      );
    };

    const handleExit = ({ sessionId }: { sessionId: string; exitCode: number }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'exited' as const } : s)),
      );
    };

    const handleCreated = (session: SessionInfo) => {
      setSessions((prev) => {
        if (prev.some((s) => s.id === session.id)) return prev;
        return [...prev, session];
      });
    };

    const handleDeleted = ({ sessionId }: { sessionId: string }) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    };

    const handleSessionError = ({ sessionId }: { sessionId: string; message: string }) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    };

    const handleGitStatus = ({ sessionId, hasGitChanges }: { sessionId: string; hasGitChanges: boolean }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, hasGitChanges } : s)),
      );
    };

    socket.on('session:status', handleStatus);
    socket.on('session:exit', handleExit);
    socket.on('session:created', handleCreated);
    socket.on('session:deleted', handleDeleted);
    socket.on('session:error', handleSessionError);
    socket.on('session:gitStatus', handleGitStatus);

    return () => {
      socket.off('session:status', handleStatus);
      socket.off('session:exit', handleExit);
      socket.off('session:created', handleCreated);
      socket.off('session:deleted', handleDeleted);
      socket.off('session:error', handleSessionError);
      socket.off('session:gitStatus', handleGitStatus);
    };
  }, [socket]);

  const createSession = useCallback(async (folderPath: string, name?: string, agentType?: string, flags?: string[], worktreeBranch?: string, worktreeBase?: string) => {
    const session = await api.createSession({ folderPath, name, agentType, flags, worktreeBranch, worktreeBase });
    setSessions((prev) => {
      if (prev.some((s) => s.id === session.id)) return prev;
      return [...prev, session];
    });
    return session;
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete session', 'danger');
    }
  }, []);

  return { sessions, loaded, createSession, deleteSession };
}
