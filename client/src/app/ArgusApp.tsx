import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../context/theme-context.js';
import { useSocket, useSocketStatus, reconnectSocket } from '../hooks/useSocket.js';
import { useSessions } from '../hooks/useSessions.js';
import { useSessionOrder } from '../hooks/useSessionOrder.js';
import { useMosaicOrder } from '../hooks/useMosaicOrder.js';
import { useGroups } from '../hooks/useGroups.js';
import { useConfig } from '../hooks/useConfig.js';
import { useNgrok } from '../hooks/useNgrok.js';
import { useUpdate } from '../hooks/useUpdate.js';
import { useNotifications } from '../hooks/useNotifications.js';
import { api, setToken } from '../services/api.js';
import { isPrimaryModifier } from '../utils/platform.js';
import type { AgentFlag, SessionInfo, AppConfig, SessionGroup, FavoriteEntryMeta } from '@argus/shared';
import { FAVORITES_GROUP_ID } from '@argus/shared';
import { resolveGroupColor } from '../constants/groupColors.js';
import { WifiOff, Loader2, Plus } from 'lucide-react';
import { AlertSheet, Button, ToastProvider, pushToast } from '../components/primitives/index.js';

import { MobileApp } from './mobile/MobileApp.js';
import { PasswordGate } from './PasswordGate.js';
import { WindowChrome } from './ui/WindowChrome.js';
import { ElectronToolbar } from './ui/ElectronToolbar.js';
import { Sidebar } from './ui/Sidebar.js';
import { SessionTree } from './ui/SessionTree.js';
import { TopToolbar } from './ui/TopToolbar.js';
import { Mosaic } from './views/Mosaic.js';
import { Focus } from './views/Focus.js';
import { Overlay } from './overlays/Overlay.js';
import { CreateSheet } from './overlays/CreateSheet.js';
import { CloneSheet } from './overlays/CloneSheet.js';
import { CommandPalette } from './overlays/CommandPalette.js';
import { UpdateSheet } from './overlays/UpdateSheet.js';
import { SettingsOverlay } from './overlays/SettingsOverlay.js';
import { DiffOverlay } from './overlays/DiffOverlay.js';
import { ExplorerOverlay } from './overlays/ExplorerOverlay.js';
import { SessionPickerSheet } from './overlays/SessionPickerSheet.js';
import { useAppView } from './state/useAppView.js';
import { useMosaicVisibility } from './state/useMosaicVisibility.js';
import { deriveCounts } from './types.js';
import type { SidebarKey } from './types.js';

export default function ArgusApp() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/mobile')) {
    return <MobileApp />;
  }
  return <DesktopRoot />;
}

function DesktopRoot() {
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

  useEffect(() => {
    document.documentElement.classList.add('is-electron');
    return () => { document.documentElement.classList.remove('is-electron'); };
  }, []);

  if (!authChecked) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-0)',
        }}
      >
        <Loader2
          size={24}
          style={{ color: 'var(--fg-3)', animation: 'argus-spin 0.9s linear infinite' }}
        />
      </div>
    );
  }

  if (authRequired && !authenticated) {
    return (
      <PasswordGate
        onAuthenticated={() => {
          setAuthenticated(true);
          reconnectSocket();
        }}
      />
    );
  }

  return <DesktopInner />;
}

function DesktopInner() {
  const { theme, isDark, toggle: toggleTheme } = useTheme();
  const socket = useSocket();
  const socketConnected = useSocketStatus();
  const { sessions, createSession, deleteSession } = useSessions(socket);
  const ngrok = useNgrok(socket);
  const { status: updateStatus } = useUpdate(socket);
  const { config, updateConfig } = useConfig();
  const { getOrderedSessions, reorder: reorderSession } = useSessionOrder();
  const { getOrderedSessions: getMosaicOrderedSessions, reorder: reorderMosaic } = useMosaicOrder();
  const groups = useGroups();

  type MergeFlow =
    | null
    | { phase: 'confirm'; session: SessionInfo; targetBranch: string; parentRepoPath: string }
    | { phase: 'merging'; session: SessionInfo; targetBranch: string; parentRepoPath: string }
    | { phase: 'success'; session: SessionInfo; targetBranch: string; mergedBranch: string; parentRepoPath: string }
    | { phase: 'error'; session: SessionInfo; error: string };

  const app = useAppView();
  const mosaicVis = useMosaicVisibility();
  const [filter, setFilter] = useState('');
  const [pendingKill, setPendingKill] = useState<SessionInfo | null>(null);
  const [pendingKillGroup, setPendingKillGroup] = useState<SessionGroup | null>(null);
  const [pendingRestart, setPendingRestart] = useState<SessionInfo | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [mergeFlow, setMergeFlow] = useState<MergeFlow>(null);

  const orderedSessions = useMemo(() => getOrderedSessions(sessions), [sessions, getOrderedSessions]);
  const mosaicSessions = useMemo(() => getMosaicOrderedSessions(sessions), [sessions, getMosaicOrderedSessions]);
  const counts = useMemo(() => deriveCounts(orderedSessions), [orderedSessions]);
  const grouped = groups.groupedSessions(orderedSessions);

  // A deleted group simply yields no active group → filter falls away on its own.
  const activeGroup = groups.groups.find((g) => g.id === activeGroupId) ?? null;
  const groupFilterIds = activeGroupId === '__others__'
    ? new Set(grouped.others.map((s) => s.id))
    : activeGroup ? new Set(activeGroup.sessionIds) : null;
  const groupColorOf = (sessionId: string): string | null => {
    const g = groups.groups.find((grp) => grp.sessionIds.includes(sessionId));
    if (g) return resolveGroupColor(g.color, isDark);
    return grouped.othersColor ? resolveGroupColor(grouped.othersColor, isDark) : null;
  };

  // Auto-exit focus when active session disappears
  const { view: appView, activeSessionId: appActiveSessionId, exitFocus: appExitFocus } = app;
  useEffect(() => {
    if (appView === 'focus' && appActiveSessionId) {
      if (!sessions.find((s) => s.id === appActiveSessionId)) {
        appExitFocus();
      }
    }
  }, [sessions, appView, appActiveSessionId, appExitFocus]);

  // Notifications
  useNotifications({
    sessions,
    enabled: config?.notificationsEnabled ?? true,
    notifyOnWaiting: config?.notifyOnWaiting ?? true,
    notifyOnDone: config?.notifyOnDone ?? false,
    onFocusSession: app.openSession,
    onSwitchToSessionsTab: () => {},
  });

  // Acknowledge 'done' when the session is open in focus view with the window
  // focused: covers opening a green session, a focused session finishing while
  // watched (skip green entirely), and refocusing the window onto a session
  // that finished while the app was in the background.
  useEffect(() => {
    const ack = () => {
      if (app.view !== 'focus' || !app.activeSessionId) return;
      const active = sessions.find((s) => s.id === app.activeSessionId);
      if (active?.status === 'done' && document.hasFocus()) {
        socket.emit('session:seen', active.id);
      }
    };
    ack();
    window.addEventListener('focus', ack);
    return () => window.removeEventListener('focus', ack);
  }, [app.view, app.activeSessionId, sessions, socket]);

  // Tab title with waiting count
  useEffect(() => {
    const waiting = counts.waiting;
    document.title = waiting > 0 ? `(${waiting}) Argus` : 'Argus';
  }, [counts.waiting]);

  // Favicon flip: green while a finished run awaits acknowledgement
  useEffect(() => {
    const hasDone = sessions.some((s) => s.status === 'done');
    const href = hasDone ? '/favicon-green.svg' : '/favicon-orange.svg';
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = href;
  }, [sessions]);

  // Global keyboard shortcuts (⌘F filter, ⌘N new session, ⌘K palette)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPrimaryModifier(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        const host = document.querySelector<HTMLElement>('[data-shortcut-host="filter"]');
        host?.querySelector<HTMLInputElement>('input')?.focus();
      } else if (k === 'n') {
        e.preventDefault();
        app.openOverlay({ kind: 'create' });
      } else if (k === 'k') {
        e.preventDefault();
        app.openOverlay({ kind: 'palette' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const activeSession: SessionInfo | null =
    app.view === 'focus' && app.activeSessionId
      ? sessions.find((s) => s.id === app.activeSessionId) ?? null
      : null;

  const handleCreate = async (folderPath: string, name: string | undefined, agentType: string, flags: string[], worktreeBranch?: string, worktreeBase?: string) => {
    const created = await createSession(folderPath, name, agentType, flags, worktreeBranch, worktreeBase);
    app.closeOverlay();
    // Stay in mosaic if creating from dashboard; only jump to focus when already focused.
    if (app.view === 'focus') app.openSession(created.id);
  };

  const handleClone = async (folderPath: string, agentType: string, flags: string[], worktreeBranch?: string) => {
    const created = await createSession(folderPath, undefined, agentType, flags, worktreeBranch);
    app.closeOverlay();
    if (app.view === 'focus') app.openSession(created.id);
  };

  const handleSpawnFromFavorite = async (
    session: SessionInfo | null,
    meta?: FavoriteEntryMeta,
    ghostId?: string,
  ) => {
    const src = meta ?? (session ? { folderPath: session.folderPath, name: session.name, agentType: session.agentType, flags: session.flags } : null);
    if (!src) return;
    try {
      const created = await createSession(src.folderPath, src.name, src.agentType, src.flags);
      groups.toggleFavorite(created);
      if (ghostId) {
        groups.removeFromFavorites(ghostId);
      } else if (session) {
        groups.removeFromFavorites(session.id);
      }
      if (app.view === 'focus') app.openSession(created.id);
    } catch {
      // createSession error is surfaced by useSessions; no extra handling needed here
    }
  };

  const handleMerge = async (session: SessionInfo) => {
    try {
      const info = await api.getWorktreeParentInfo(session.id);
      setMergeFlow({ phase: 'confirm', session, targetBranch: info.defaultBranch, parentRepoPath: info.parentRepoPath });
    } catch (err) {
      setMergeFlow({ phase: 'error', session, error: err instanceof Error ? err.message : 'Failed to detect target branch' });
    }
  };

  const executeMerge = async () => {
    if (mergeFlow?.phase !== 'confirm') return;
    const { session, targetBranch, parentRepoPath } = mergeFlow;
    setMergeFlow({ phase: 'merging', session, targetBranch, parentRepoPath });
    try {
      const result = await api.mergeWorktree(session.id, targetBranch);
      if (result.success) {
        setMergeFlow({ phase: 'success', session, targetBranch, mergedBranch: result.mergedBranch ?? session.worktreeBranch ?? '', parentRepoPath: result.parentRepoPath ?? parentRepoPath });
      } else {
        setMergeFlow({ phase: 'error', session, error: result.error ?? 'Merge failed' });
      }
    } catch (err) {
      setMergeFlow({ phase: 'error', session, error: err instanceof Error ? err.message : 'Merge failed' });
    }
  };

  const handleMergeDeleteWorktree = async () => {
    if (mergeFlow?.phase !== 'success') return;
    const { session, parentRepoPath } = mergeFlow;
    setMergeFlow(null);
    try {
      await deleteSession(session.id);
    } catch {
      pushToast('Failed to close session', 'warn');
      return;
    }
    if (app.view === 'focus' && app.activeSessionId === session.id) app.exitFocus();
    try {
      await api.deleteWorktree(session.worktreePath!, parentRepoPath, false);
    } catch {
      pushToast('Session closed, but worktree cleanup failed — check ~/.argus/worktrees', 'warn');
    }
  };

  const handleSaveFlag = async (agentId: string, flag: AgentFlag) => {
    if (!config) return;
    const existing = config.agentFlags[agentId] ?? [];
    const updated = existing.find((f) => f.id === flag.id)
      ? existing.map((f) => (f.id === flag.id ? flag : f))
      : [...existing, flag];
    await updateConfig({ agentFlags: { ...config.agentFlags, [agentId]: updated } });
  };

  const handleDeleteFlag = async (agentId: string, flagId: string) => {
    if (!config) return;
    const updated = (config.agentFlags[agentId] ?? []).filter((f) => f.id !== flagId);
    await updateConfig({ agentFlags: { ...config.agentFlags, [agentId]: updated } });
  };

  const handleSidebar = (key: SidebarKey) => {
    switch (key) {
      case 'sessions':
        setFilter('');
        app.exitFocus();
        return;
      case 'palette':
        app.openOverlay({ kind: 'palette' });
        return;
      case 'settings':
        app.openOverlay({ kind: 'settings' });
        return;
    }
  };

  const sidebarActive: SidebarKey =
    app.overlay?.kind === 'settings'
      ? 'settings'
      : 'sessions';

  const headerLeading = (
    <TopToolbar
      filter={filter}
      onFilter={setFilter}
      sessions={orderedSessions}
      activeSessionId={app.activeSessionId ?? undefined}
      onSelectSession={app.openSession}
    />
  );

  const headerToolbar = (
    <>
      <ElectronToolbar
        onOpenSettings={() => app.openOverlay({ kind: 'settings' })}
        onToggleTheme={toggleTheme}
        onOpenRemote={() => app.openOverlay({ kind: 'settings', initialTab: 'remote' })}
        isDark={isDark}
        ngrokConnected={ngrok.status?.tunnelStatus === 'connected'}
        updateAvailable={updateStatus?.hasUpdate}
        updateVersion={updateStatus?.latestVersion ?? undefined}
        onOpenUpdate={() => app.openOverlay({ kind: 'update' })}
      />
      <Button variant="primary" icon={Plus} size="md" onClick={() => app.openOverlay({ kind: 'create' })}>
        New
      </Button>
    </>
  );

  return (
    <ToastProvider>
    <WindowChrome
      title="ARGUS"
      leading={headerLeading}
      toolbar={headerToolbar}
    >
      <a href="#main" className="skip-link">Skip to main content</a>
      {!socketConnected && (
        <div
          role="alert"
          className="eyebrow"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '6px 16px',
            background: 'var(--warn-bg)',
            borderBottom: '1px solid color-mix(in srgb, var(--warn) 33%, transparent)',
            color: 'var(--warn)',
            fontSize: 'var(--t-tiny)',
            flexShrink: 0,
          }}
        >
          <WifiOff size={13} strokeWidth={1.6} />
          CONNECTION LOST — RECONNECTING…
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar
          active={sidebarActive}
          counts={counts}
          onSelect={handleSidebar}
          version={updateStatus?.currentVersion}
          ngrokConnected={ngrok.status?.tunnelStatus === 'connected'}
          sessionTree={
            <SessionTree
              grouped={grouped}
              activeGroupId={activeGroupId}
              isDark={isDark}
              onAssign={groups.assign}
              onToggleCollapsed={groups.toggleCollapsed}
              onFilterGroup={(id) => { setActiveGroupId(id); app.exitFocus(); }}
              onCreateGroup={(name) => groups.createGroup(name)}
              onRenameGroup={groups.renameGroup}
              onSetColor={groups.setColor}
              onSetOthersColor={groups.setOthersColor}
              onDeleteGroup={groups.deleteGroup}
              onKillGroup={setPendingKillGroup}
              onKillOthers={() => setPendingKillGroup({
                id: '__others__',
                name: 'Others',
                color: 'gray',
                collapsed: false,
                sessionIds: grouped.others.map((s) => s.id),
              })}
              onOpenSession={app.openSession}
              onToggleFavorite={groups.toggleFavorite}
              onSpawnFromFavorite={handleSpawnFromFavorite}
              isFavorite={groups.isFavorite}
              onToggleFavoritesCollapsed={() => groups.toggleCollapsed(FAVORITES_GROUP_ID)}
            />
          }
        />

        <main id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {app.view === 'dashboard' && (
            <Mosaic
              sessions={mosaicSessions}
              onReorder={reorderMosaic}
              filter={filter}
              socket={socket}
              theme={theme}
              groupFilterIds={groupFilterIds}
              activeGroupId={activeGroupId}
              groupColorOf={groupColorOf}
              toggleMinimize={mosaicVis.toggleMinimize}
              restoreFromFilter={mosaicVis.restoreFromFilter}
              isMinimized={mosaicVis.isMinimized}
              onOpenSession={app.openSession}
              onCreate={() => app.openOverlay({ kind: 'create' })}
              onKill={setPendingKill}
              onRestart={setPendingRestart}
              onMerge={handleMerge}
              onClone={(s) => app.openOverlay({ kind: 'clone', folderPath: s.folderPath, agentType: s.agentType })}
              mergingSessionId={mergeFlow?.phase === 'merging' ? mergeFlow.session.id : null}
              onFocusDiff={(id) => { app.openSession(id); app.openSidePanel({ kind: 'diff', sessionId: id }); }}
              onFocusExplorer={(id) => { app.openSession(id); app.openSidePanel({ kind: 'explorer', sessionId: id }); }}
              onFocusTerminal={(id) => { app.openSession(id); app.openSidePanel({ kind: 'terminal', sessionId: id }); }}
              onOpenDiff={(id) => app.openOverlay({ kind: 'diff', sessionId: id })}
            />
          )}

          {app.view === 'focus' && activeSession && (
            <Focus
              sessions={orderedSessions}
              active={activeSession}
              socket={socket}
              theme={theme}
              sidePanel={app.sidePanel}
              filter={filter}
              onSelect={app.setActiveSession}
              onReorder={reorderSession}
              onBack={app.exitFocus}
              onToggleDiff={() => app.toggleSidePanel('diff', activeSession.id)}
              onToggleExplorer={() => app.toggleSidePanel('explorer', activeSession.id)}
              onToggleTerminal={() => app.toggleSidePanel('terminal', activeSession.id)}
              onExpandDiff={(file) => app.openOverlay({ kind: 'diff', sessionId: activeSession.id, file })}
              onExpandExplorer={(filePath) => app.openOverlay({ kind: 'explorer', sessionId: activeSession.id, filePath })}
              onClone={() => app.openOverlay({ kind: 'clone', folderPath: activeSession.folderPath, agentType: activeSession.agentType })}
              onKill={() => setPendingKill(activeSession)}
              onRestart={() => setPendingRestart(activeSession)}
            />
          )}
        </main>
      </div>

      {/* Overlays */}
      {app.overlay?.kind === 'create' && (
        <Overlay onClose={app.closeOverlay} dialog={false}>
          <CreateSheet
            config={config}
            onClose={app.closeOverlay}
            onCreate={handleCreate}
            onSaveFlag={handleSaveFlag}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'clone' && (
        <Overlay onClose={app.closeOverlay} label="Clone session">
          <CloneSheet
            config={config}
            folderPath={app.overlay.folderPath}
            currentAgentType={app.overlay.agentType}
            onClose={app.closeOverlay}
            onClone={handleClone}
            onSaveFlag={handleSaveFlag}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'palette' && (
        <Overlay onClose={app.closeOverlay} align="top" label="Command palette">
          <CommandPalette
            sessions={sessions}
            initialScopeSessionId={app.view === 'focus' ? app.activeSessionId : null}
            onClose={app.closeOverlay}
            onJumpSession={(id) => { app.closeOverlay(); app.openSession(id); }}
            onOpenInExplorer={(sessionId, filePath, lineNumber) => {
              app.openOverlay({ kind: 'explorer', sessionId, filePath, lineNumber });
            }}
            onOpenInDiff={(sessionId) => {
              app.openOverlay({ kind: 'diff', sessionId });
            }}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'update' && updateStatus && (
        <Overlay onClose={app.closeOverlay} label="Update Argus">
          <UpdateSheet status={updateStatus} onClose={app.closeOverlay} />
        </Overlay>
      )}
      {app.overlay?.kind === 'settings' && config && (
        <Overlay onClose={app.closeOverlay} label="Settings">
          <SettingsOverlay
            config={config as AppConfig}
            sessions={sessions}
            onClose={app.closeOverlay}
            onSave={updateConfig}
            onSaveFlag={handleSaveFlag}
            onDeleteFlag={handleDeleteFlag}
            ngrokStatus={ngrok.status}
            ngrokLoading={ngrok.loading}
            ngrokError={ngrok.error}
            onNgrokStart={ngrok.startTunnel}
            onNgrokStop={ngrok.stopTunnel}
            initialTab={app.overlay.initialTab}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'diff' && (() => {
        const ov = app.overlay as { sessionId: string; file?: string };
        const session = sessions.find((s) => s.id === ov.sessionId);
        return session ? (
          <Overlay onClose={app.closeOverlay} label="Diff viewer">
            <DiffOverlay session={session} onClose={app.closeOverlay} initialFile={ov.file} />
          </Overlay>
        ) : null;
      })()}
      {app.overlay?.kind === 'explorer' && (() => {
        const ov = app.overlay as { sessionId: string; filePath?: string; lineNumber?: number };
        const session = sessions.find((s) => s.id === ov.sessionId);
        return session ? (
          <Overlay onClose={app.closeOverlay} label="File explorer">
            <ExplorerOverlay session={session} onClose={app.closeOverlay} initialFilePath={ov.filePath} initialLine={ov.lineNumber} />
          </Overlay>
        ) : null;
      })()}
      {app.overlay?.kind === 'sessionPicker' && (() => {
        const target = app.overlay.target;
        return (
          <Overlay onClose={app.closeOverlay} label="Pick a session">
            <SessionPickerSheet
              sessions={orderedSessions}
              target={target}
              onClose={app.closeOverlay}
              onPick={(id) => app.openOverlay({ kind: target, sessionId: id })}
            />
          </Overlay>
        );
      })()}

      <AlertSheet
        isOpen={!!pendingKill}
        title="Close shell?"
        message={
          pendingKill?.worktreePath
            ? `This session has work that hasn't been applied to your project yet. Close anyway?`
            : `This ends the "${pendingKill?.name}" agent process. Files on disk and git history are not touched.`
        }
        confirmLabel="Close"
        confirmDestructive
        onConfirm={() => {
          if (pendingKill) {
            const id = pendingKill.id;
            void deleteSession(id);
            if (app.view === 'focus' && app.activeSessionId === id) app.exitFocus();
          }
          setPendingKill(null);
        }}
        onCancel={() => setPendingKill(null)}
      />

      <AlertSheet
        isOpen={!!pendingRestart}
        title="Restart shell?"
        message={`This relaunches the "${pendingRestart?.name}" agent process and clears the terminal. Files on disk and git history are not touched.`}
        confirmLabel="Restart"
        onConfirm={() => {
          if (pendingRestart) api.restartSession(pendingRestart.id).catch(console.error);
          setPendingRestart(null);
        }}
        onCancel={() => setPendingRestart(null)}
      />

      <AlertSheet
        isOpen={mergeFlow?.phase === 'confirm'}
        title="Apply changes?"
        message={mergeFlow?.phase === 'confirm' ? `Apply this session's work to ${mergeFlow.targetBranch}.` : ''}
        confirmLabel="Apply"
        onConfirm={() => { void executeMerge(); }}
        onCancel={() => setMergeFlow(null)}
      />

      <AlertSheet
        isOpen={mergeFlow?.phase === 'success'}
        title="Changes applied"
        message={mergeFlow?.phase === 'success' ? `Your work is now in ${mergeFlow.targetBranch}. Close this session?` : ''}
        confirmLabel="Close session"
        confirmDestructive
        onConfirm={() => { void handleMergeDeleteWorktree(); }}
        onCancel={() => setMergeFlow(null)}
      />

      <AlertSheet
        isOpen={mergeFlow?.phase === 'error'}
        title="Couldn't apply changes"
        message={mergeFlow?.phase === 'error' ? mergeFlow.error : ''}
        confirmLabel="Got it"
        onConfirm={() => setMergeFlow(null)}
        onCancel={() => setMergeFlow(null)}
      />

      <AlertSheet
        isOpen={!!pendingKillGroup}
        title="Close all shells in group?"
        message={`This ends every agent process in "${pendingKillGroup?.name}" (${pendingKillGroup?.sessionIds.length ?? 0}). Files on disk and git history are not touched.`}
        confirmLabel="Close all"
        confirmDestructive
        onConfirm={() => {
          if (pendingKillGroup) {
            for (const id of [...pendingKillGroup.sessionIds]) {
              void deleteSession(id);
              if (app.view === 'focus' && app.activeSessionId === id) app.exitFocus();
            }
          }
          setPendingKillGroup(null);
        }}
        onCancel={() => setPendingKillGroup(null)}
      />
    </WindowChrome>
    </ToastProvider>
  );
}
