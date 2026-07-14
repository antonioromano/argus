import { useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { useSocket } from '../../hooks/useSocket.js';
import { useSessions } from '../../hooks/useSessions.js';
import { useGroups, type GhostFavorite } from '../../hooks/useGroups.js';
import { useNgrok } from '../../hooks/useNgrok.js';
import { useNotificationPref, useDoneNotificationPref } from '../../hooks/useNotificationPref.js';
import { useWaitingNotifications } from '../../hooks/useWaitingNotifications.js';
import { api, setToken } from '../../services/api.js';
import { reconnectSocket } from '../../hooks/useSocket.js';
import { AlertSheet } from '../../components/primitives/index.js';
import { PasswordGate } from '../PasswordGate.js';
import { Sessions } from './Sessions.js';
import { Focus } from './Focus.js';
import { MobileSettings } from './MobileSettings.js';
import { ActionSheet } from './ActionSheet.js';
import { CreateSheet } from './CreateSheet.js';
import { BottomNav } from './BottomNav.js';
import type { MobileTab } from './BottomNav.js';

export function MobileApp() {
  const socket = useSocket();
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    api.getAuthStatus().then((s) => {
      setAuthRequired(s.required);
      setAuthenticated(s.authenticated ?? !s.required);
      setAuthChecked(true);
    }).catch(() => {
      setAuthRequired(false);
      setAuthenticated(true);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    const handler = (payload: { required: boolean }) => {
      setAuthRequired(payload.required);
      if (!payload.required) {
        setAuthenticated(true);
        setToken(null);
      }
    };
    socket.on('auth:required', handler);
    return () => { socket.off('auth:required', handler); };
  }, [socket]);

  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  if (!authChecked) return null;
  if (authRequired && !authenticated) {
    return <PasswordGate onAuthenticated={() => { setAuthenticated(true); reconnectSocket(); }} />;
  }
  return <Inner />;
}

function Inner() {
  const socket = useSocket();
  const { sessions, createSession, deleteSession } = useSessions(socket);
  const groups = useGroups();
  // Destructure the stable useCallback so the memo keys on it directly (keying on
  // `groups` would recompute every render — useGroups returns a fresh object).
  const { groupedSessions } = groups;
  const grouped = useMemo(() => groupedSessions(sessions), [groupedSessions, sessions]);
  const { status: ngrokStatus } = useNgrok(socket);
  const [tab, setTab] = useState<MobileTab>('sessions');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionTarget, setActionTarget] = useState<SessionInfo | null>(null);
  const [killTarget, setKillTarget] = useState<SessionInfo | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  const [notify, setNotifyPref] = useNotificationPref();
  const [notifyDone, setNotifyDonePref] = useDoneNotificationPref();

  useWaitingNotifications(sessions, notify, notifyDone);

  const focused = focusedId ? sessions.find((s) => s.id === focusedId) ?? null : null;

  // Acknowledge 'done' when the session is open on this phone.
  useEffect(() => {
    if (focused?.status === 'done') {
      socket.emit('session:seen', focused.id);
    }
  }, [focused, socket]);
  const publicUrl = ngrokStatus?.tunnelStatus === 'connected' ? ngrokStatus.publicUrl ?? null : null;

  // Enabling requires a permission grant (must run from the toggle's user gesture).
  const ensurePermission = async (): Promise<boolean> => {
    if (typeof Notification === 'undefined') return true;
    const p = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    return p === 'granted';
  };
  const setNotify = async (v: boolean) => {
    if (v && !(await ensurePermission())) return;
    setNotifyPref(v);
  };
  const setNotifyDone = async (v: boolean) => {
    if (v && !(await ensurePermission())) return;
    setNotifyDonePref(v);
  };

  const handleRestart = (id: string) => { api.restartSession(id).catch(console.error); };
  const handleMarkDone = (id: string) => { socket.emit('session:mark-done', id); };

  // Relaunch a spun-down favourite: spawn a fresh shell from its saved
  // folder/agent/flags, re-favourite the live session, and drop the ghost.
  const handleSpawnFromFavorite = async (ghost: GhostFavorite) => {
    const { meta } = ghost;
    try {
      const created = await createSession(meta.folderPath, meta.name, meta.agentType, meta.flags);
      groups.toggleFavorite(created);
      groups.removeFromFavorites(ghost.id);
      setFocusedId(created.id);
    } catch (e) {
      console.error(e);
    }
  };

  const confirmKill = async () => {
    if (!killTarget) return;
    setKillBusy(true);
    try {
      await deleteSession(killTarget.id);
      if (focusedId === killTarget.id) setFocusedId(null);
      setKillTarget(null);
    } catch (e) {
      console.error(e);
    } finally {
      setKillBusy(false);
    }
  };

  const handleCreate = async (
    folderPath: string, name: string | undefined, agentType: string | undefined,
    flags: string[], worktreeBranch?: string, worktreeBase?: string,
  ) => {
    const session = await createSession(folderPath, name, agentType, flags, worktreeBranch, worktreeBase);
    setShowCreate(false);
    setFocusedId(session.id);
  };

  return (
    <>
      {focused ? (
        <Focus
          session={focused}
          onBack={() => setFocusedId(null)}
          onActions={() => setActionTarget(focused)}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {tab === 'sessions' && (
              <Sessions
                sessions={sessions}
                grouped={grouped}
                publicUrl={publicUrl}
                onSelect={setFocusedId}
                onAction={setActionTarget}
                onSpawnFavorite={handleSpawnFromFavorite}
                onCreate={() => setShowCreate(true)}
              />
            )}
            {tab === 'settings' && <MobileSettings publicUrl={publicUrl} notify={notify} onSetNotify={setNotify} notifyDone={notifyDone} onSetNotifyDone={setNotifyDone} />}
          </div>
          <BottomNav
            active={tab}
            onChange={setTab}
            onCreate={() => setShowCreate(true)}
            doneCount={sessions.filter((s) => s.status === 'done').length}
            waitingCount={sessions.filter((s) => s.status === 'waiting').length}
          />
        </div>
      )}

      <ActionSheet
        session={actionTarget}
        isFavorite={actionTarget ? groups.isFavorite(actionTarget.id) : false}
        onOpen={(id) => setFocusedId(id)}
        onMarkDone={handleMarkDone}
        onRestart={handleRestart}
        onToggleFavorite={(s) => groups.toggleFavorite(s)}
        onKill={(s) => setKillTarget(s)}
        onClose={() => setActionTarget(null)}
      />

      <AlertSheet
        isOpen={!!killTarget}
        title={killTarget ? `Kill ${killTarget.name}?` : ''}
        message={
          killTarget?.worktreePath
            ? 'This stops the agent process. The worktree and any uncommitted changes are left on disk — remove it from Argus on your Mac.'
            : 'This stops the agent process. Terminal scrollback is lost.'
        }
        confirmLabel="Kill shell"
        confirmDestructive
        confirmLoading={killBusy}
        onConfirm={confirmKill}
        onCancel={() => setKillTarget(null)}
      />

      {showCreate && (
        <CreateSheet
          sessions={sessions}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
