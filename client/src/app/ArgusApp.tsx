import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../context/theme-context.js';
import { FontSettingsProvider } from '../context/FontSettingsContext.js';
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
import { useShortcuts } from '../keyboard/useShortcuts.js';
import type { AgentFlag, SessionInfo, AppConfig, SessionGroup, FavoriteEntryMeta, WorktreeMergePreviewResponse } from '@argus/shared';
import { FAVORITES_GROUP_ID } from '@argus/shared';
import { resolveGroupColor } from '../constants/groupColors.js';
import { WifiOff, Loader2, Plus } from 'lucide-react';
import { AlertSheet, Button, ToastProvider, pushToast, Tooltip } from '../components/primitives/index.js';

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
import { MergePreviewSheet } from './overlays/MergePreviewSheet.js';
import { SessionPickerSheet } from './overlays/SessionPickerSheet.js';
import { useAppView } from './state/useAppView.js';
import { useMosaicVisibility } from './state/useMosaicVisibility.js';
import { deriveCounts } from './types.js';
import type { SidebarKey } from './types.js';

export default function ArgusApp() {
  // Pause infinite background animations (waiting pulses, sweeps, marquee, landing
  // glow) while the window is hidden in the tray. They otherwise repaint forever on
  // the CPU (GPU compositing is disabled app-wide); pausing frees the CPU and stops
  // wasted work no one can see. Drives `body.argus-bg-idle` (see index.css).
  useEffect(() => {
    const sync = () => document.body.classList.toggle('argus-bg-idle', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/mobile')) {
    return <MobileApp />;
  }
  return <DesktopRoot />;
}

const RECENT_FOLDERS_KEY = 'argus.recent-folders';

function addToRecentFolders(folderPath: string): void {
  try {
    const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
    const prev: Array<{ path: string; lastOpened: number }> = stored ? JSON.parse(stored) : [];
    const next = [
      { path: folderPath, lastOpened: Date.now() },
      ...prev.filter((e) => e.path !== folderPath),
    ].slice(0, 100);
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
  } catch { /* non-critical */ }
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
  const { status: updateStatus, progress: updateProgress, failure: updateFailure, resetUpdateState } = useUpdate(socket);
  const { config, updateConfig } = useConfig();
  const { getOrderedSessions, reorder: reorderSession } = useSessionOrder();
  const { getOrderedSessions: getMosaicOrderedSessions, reorder: reorderMosaic } = useMosaicOrder();
  const groups = useGroups();

  type MergeFlow =
    | null
    | { phase: 'preview'; session: SessionInfo; targetBranch: string; parentRepoPath: string; preview: WorktreeMergePreviewResponse | null; availableBranches: string[] }
    | { phase: 'merging'; session: SessionInfo; targetBranch: string; parentRepoPath: string }
    | { phase: 'success'; session: SessionInfo; targetBranch: string; mergedBranch: string; parentRepoPath: string }
    | { phase: 'error'; session: SessionInfo; error: string; targetBranch?: string; parentRepoPath?: string };

  const app = useAppView();
  const mosaicVis = useMosaicVisibility();
  const [filter, setFilter] = useState('');
  const [notifiedTileId, setNotifiedTileId] = useState<string | null>(null);
  const notifiedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingKill, setPendingKill] = useState<SessionInfo | null>(null);
  const [pendingKillGroup, setPendingKillGroup] = useState<SessionGroup | null>(null);
  const [pendingRestart, setPendingRestart] = useState<SessionInfo | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [mergeFlow, setMergeFlow] = useState<MergeFlow>(null);

  // Resolved keyboard shortcuts (registry defaults + user overrides from config).
  const shortcuts = useShortcuts(config?.keyboardShortcuts);

  // Which terminal is "active" for Cmd+W / Cmd+F: the focused mosaic tile on the
  // dashboard, or the open session in focus view. Mosaic reports its focused tile up.
  const [mosaicFocusedId, setMosaicFocusedId] = useState<string | null>(null);
  const activeTerminalId = app.view === 'focus' ? app.activeSessionId : mosaicFocusedId;

  // Session whose in-terminal search bar is open (null = none).
  const [searchSessionId, setSearchSessionId] = useState<string | null>(null);
  const openTerminalSearch = useCallback(() => {
    setSearchSessionId((cur) => activeTerminalId ?? cur);
  }, [activeTerminalId]);
  const openTerminalSearchFor = useCallback((id: string) => setSearchSessionId(id), []);
  const closeTerminalSearch = useCallback(() => setSearchSessionId(null), []);

  // Whether closing a shell shows the confirm modal (off → close immediately).
  const confirmCloseShell = config?.confirmCloseShell !== false;
  const [killRemember, setKillRemember] = useState(false);

  // Close a shell, honoring the saved "don't ask again" choice. Shared by the card
  // close button and Cmd+W (menu:close-session).
  const requestKill = useCallback((s: SessionInfo) => {
    if (!confirmCloseShell) {
      void deleteSession(s.id);
      if (app.view === 'focus' && app.activeSessionId === s.id) app.exitFocus();
      return;
    }
    setKillRemember(false);
    setPendingKill(s);
  }, [confirmCloseShell, deleteSession, app]);

  // Cmd+W → close the active terminal's shell. Registered once; reads latest state via ref.
  const closeActiveShell = useCallback(() => {
    if (!activeTerminalId) return;
    const s = sessions.find((x) => x.id === activeTerminalId);
    if (s) requestKill(s);
  }, [activeTerminalId, sessions, requestKill]);
  const closeActiveShellRef = useRef(closeActiveShell);
  useEffect(() => { closeActiveShellRef.current = closeActiveShell; }, [closeActiveShell]);
  // Cmd+N → open the create-session overlay. Owned by the Electron menu accelerator
  // so it survives terminal focus (xterm swallows the keydown before it reaches the
  // window listener). The window-keydown fallback below still handles non-terminal
  // focus; openOverlay is idempotent so a redundant double-fire is harmless.
  const openCreate = useCallback(() => app.openOverlay({ kind: 'create' }), [app]);
  const openCreateRef = useRef(openCreate);
  useEffect(() => { openCreateRef.current = openCreate; }, [openCreate]);
  useEffect(() => {
    const bridge = window.electronApp;
    if (!bridge) return;
    const offClose = bridge.onMenu('menu:close-session', () => closeActiveShellRef.current());
    const offNew = bridge.onMenu('menu:new-session', () => openCreateRef.current());
    return () => { offClose(); offNew(); };
  }, []);

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

  // Notification click: highlight the tile in the mosaic (rather than jumping to focus mode).
  const highlightSession = useCallback((id: string) => {
    if (app.view === 'focus') app.exitFocus();
    if (notifiedTileTimerRef.current) clearTimeout(notifiedTileTimerRef.current);
    setNotifiedTileId(id);
    notifiedTileTimerRef.current = setTimeout(() => setNotifiedTileId(null), 1200);
  }, [app]);

  // Notifications
  useNotifications({
    sessions,
    enabled: config?.notificationsEnabled ?? true,
    notifyOnWaiting: config?.notifyOnWaiting ?? true,
    notifyOnDone: config?.notifyOnDone ?? false,
    notificationSound: config?.notificationSound ?? false,
    onFocusSession: highlightSession,
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

  // Global keyboard shortcuts — resolved from the registry (overridable in settings).
  // Terminal-scoped actions (clear, newline, search-when-focused) are owned by useTerminal;
  // close-shell is owned by the Electron menu accelerator (see the menu:close-session listener).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      switch (shortcuts.match(e)) {
        case 'new-session':
          if (isTyping) return;
          e.preventDefault();
          app.openOverlay({ kind: 'create' });
          break;
        case 'open-settings':
          e.preventDefault();
          app.openOverlay({ kind: 'settings' });
          break;
        case 'command-palette':
          e.preventDefault();
          if (app.overlay?.kind === 'palette') app.closeOverlay();
          else app.openOverlay({ kind: 'palette' });
          break;
        case 'terminal-search':
          // Fallback when no terminal owns the keystroke (e.g. focus is on the shell
          // chrome). Open search for the active terminal; useTerminal handles the
          // focused-terminal case and swallows the default.
          e.preventDefault();
          openTerminalSearch();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, shortcuts, openTerminalSearch]);

  const activeSession: SessionInfo | null =
    app.view === 'focus' && app.activeSessionId
      ? sessions.find((s) => s.id === app.activeSessionId) ?? null
      : null;

  const handleCreate = async (folderPath: string, name: string | undefined, agentType: string, flags: string[], worktreeBranch?: string, worktreeBase?: string) => {
    const created = await createSession(folderPath, name, agentType, flags, worktreeBranch, worktreeBase);
    addToRecentFolders(folderPath);
    app.closeOverlay();
    // Stay in mosaic if creating from dashboard; only jump to focus when already focused.
    if (app.view === 'focus') app.openSession(created.id);
  };

  const handleClone = async (folderPath: string, agentType: string, flags: string[], worktreeBranch?: string) => {
    const created = await createSession(folderPath, undefined, agentType, flags, worktreeBranch);
    addToRecentFolders(folderPath);
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
      addToRecentFolders(src.folderPath);
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
      const [info, branchesRes] = await Promise.all([
        api.getWorktreeParentInfo(session.id),
        api.listBranchesForRepo(session.folderPath).catch(() => ({ branches: [] as string[], currentBranch: '' })),
      ]);
      setMergeFlow({
        phase: 'preview',
        session,
        targetBranch: info.defaultBranch,
        parentRepoPath: info.parentRepoPath,
        preview: null,
        availableBranches: branchesRes.branches,
      });
      const preview = await api.getMergePreview(session.id, info.defaultBranch);
      setMergeFlow((cur) =>
        cur?.phase === 'preview' ? { ...cur, preview } : cur
      );
    } catch (err) {
      setMergeFlow((cur) => ({
        phase: 'error',
        session: cur?.session ?? session,
        error: err instanceof Error ? err.message : 'Failed to load merge preview',
        targetBranch: cur?.phase === 'preview' ? cur.targetBranch : undefined,
        parentRepoPath: cur?.phase === 'preview' ? cur.parentRepoPath : undefined,
      }));
    }
  };

  const executeMerge = async (targetBranch: string) => {
    if (mergeFlow?.phase !== 'preview') return;
    const { session, parentRepoPath } = mergeFlow;
    setMergeFlow({ phase: 'merging', session, targetBranch, parentRepoPath });
    try {
      const result = await api.mergeWorktree(session.id, targetBranch);
      if (result.success) {
        setMergeFlow({ phase: 'success', session, targetBranch, mergedBranch: result.mergedBranch ?? session.worktreeBranch ?? '', parentRepoPath: result.parentRepoPath ?? parentRepoPath });
      } else {
        setMergeFlow({ phase: 'error', session, error: result.error ?? 'Merge failed', targetBranch, parentRepoPath });
      }
    } catch (err) {
      setMergeFlow({ phase: 'error', session, error: err instanceof Error ? err.message : 'Merge failed', targetBranch, parentRepoPath });
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
        showClock={config?.showClock ?? false}
        clockShowSeconds={config?.clockShowSeconds ?? false}
      />
      <Tooltip content="⌘N">
        <Button variant="primary" icon={Plus} size="md" onClick={() => app.openOverlay({ kind: 'create' })}>
          New
        </Button>
      </Tooltip>
    </>
  );

  return (
    <FontSettingsProvider uiFontSize={config?.uiFontSize} codeFontSize={config?.codeFontSize}>
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
                name: config?.othersFolderName ?? 'Others',
                color: 'gray',
                collapsed: false,
                sessionIds: grouped.others.map((s) => s.id),
              })}
              onOpenSession={app.openSession}
              onToggleFavorite={groups.toggleFavorite}
              onSpawnFromFavorite={handleSpawnFromFavorite}
              isFavorite={groups.isFavorite}
              onToggleFavoritesCollapsed={() => groups.toggleCollapsed(FAVORITES_GROUP_ID)}
              othersFolderName={config?.othersFolderName ?? 'Others'}
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
              restoreAll={mosaicVis.restoreAll}
              isMinimized={mosaicVis.isMinimized}
              onOpenSession={app.openSession}
              onCreate={() => app.openOverlay({ kind: 'create' })}
              onKill={requestKill}
              onRestart={setPendingRestart}
              onMarkDone={(s) => socket.emit('session:mark-done', s.id)}
              onMerge={handleMerge}
              onClone={(s) => app.openOverlay({ kind: 'clone', folderPath: s.folderPath, agentType: s.agentType })}
              mergingSessionId={mergeFlow?.phase === 'merging' ? mergeFlow.session.id : null}
              onFocusDiff={(id) => app.openMaximized({ kind: 'diff', sessionId: id })}
              onFocusExplorer={(id) => app.openMaximized({ kind: 'explorer', sessionId: id })}
              onFocusTerminal={(id) => { app.openSession(id); app.openSidePanel({ kind: 'terminal', sessionId: id }); }}
              onOpenDiff={(id) => app.openMaximized({ kind: 'diff', sessionId: id })}
              shortcuts={shortcuts.resolved}
              searchSessionId={searchSessionId}
              onRequestSearch={openTerminalSearchFor}
              onCloseSearch={closeTerminalSearch}
              onActiveTerminalChange={setMosaicFocusedId}
              notifiedTileId={notifiedTileId}
              waitingStyle={config?.mosaicWaitingStyle ?? 'breathing'}
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
              onToggleDiff={() => app.sidePanel?.kind === 'diff'
                ? app.dismissMaximized()
                : app.maximizeSidePanel({ kind: 'diff', sessionId: activeSession.id })}
              onToggleExplorer={() => app.sidePanel?.kind === 'explorer'
                ? app.dismissMaximized()
                : app.maximizeSidePanel({ kind: 'explorer', sessionId: activeSession.id })}
              onToggleTerminal={() => app.toggleSidePanel('terminal', activeSession.id)}
              onExpandDiff={(file) => app.maximizeSidePanel({ kind: 'diff', sessionId: activeSession.id, file })}
              onRestore={app.dismissMaximized}
              onClone={() => app.openOverlay({ kind: 'clone', folderPath: activeSession.folderPath, agentType: activeSession.agentType })}
              onKill={() => requestKill(activeSession)}
              onRestart={() => setPendingRestart(activeSession)}
              shortcuts={shortcuts.resolved}
              searchOpen={searchSessionId === activeSession.id}
              onOpenSearch={() => openTerminalSearchFor(activeSession.id)}
              onCloseSearch={closeTerminalSearch}
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
        <Overlay onClose={app.closeOverlay} align="top" label="Find & Jump">
          <CommandPalette
            sessions={sessions}
            initialScopeSessionId={app.view === 'focus' ? app.activeSessionId : null}
            onClose={app.closeOverlay}
            onJumpSession={(id) => { app.closeOverlay(); app.openSession(id); }}
            onOpenInExplorer={(sessionId, filePath, lineNumber, query) => {
              app.closeOverlay();
              app.openMaximized({ kind: 'explorer', sessionId, filePath, lineNumber, query });
            }}
            onOpenInDiff={(sessionId) => {
              app.closeOverlay();
              app.openMaximized({ kind: 'diff', sessionId });
            }}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'update' && updateStatus && (
        <Overlay onClose={app.closeOverlay} label="Update Argus">
          <UpdateSheet
            status={updateStatus}
            progress={updateProgress}
            failure={updateFailure}
            onResetState={resetUpdateState}
            onClose={app.closeOverlay}
          />
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
      {app.overlay?.kind === 'sessionPicker' && (() => {
        const target = app.overlay.target;
        return (
          <Overlay onClose={app.closeOverlay} label="Pick a session">
            <SessionPickerSheet
              sessions={orderedSessions}
              target={target}
              onClose={app.closeOverlay}
              onPick={(id) => { app.closeOverlay(); app.openMaximized({ kind: target, sessionId: id }); }}
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
        rememberChoice={{ label: "Don't ask again", checked: killRemember, onChange: setKillRemember }}
        onConfirm={() => {
          if (pendingKill) {
            const id = pendingKill.id;
            void deleteSession(id);
            if (app.view === 'focus' && app.activeSessionId === id) app.exitFocus();
          }
          if (killRemember) void updateConfig({ confirmCloseShell: false });
          setPendingKill(null);
        }}
        onCancel={() => setPendingKill(null)}
      />

      <AlertSheet
        isOpen={!!pendingRestart}
        title="Restart shell?"
        message={`This relaunches the "${pendingRestart?.name}" agent process and clears the terminal. Files on disk and git history are not touched.`}
        confirmLabel="Restart"
        confirmDestructive
        onConfirm={() => {
          if (pendingRestart) api.restartSession(pendingRestart.id).catch(console.error);
          setPendingRestart(null);
        }}
        onCancel={() => setPendingRestart(null)}
      />

      {mergeFlow && (
        <MergePreviewSheet
          mergeFlow={mergeFlow}
          onClose={() => setMergeFlow(null)}
          onMerge={(branch) => { void executeMerge(branch); }}
          onCleanUp={() => { void handleMergeDeleteWorktree(); }}
        />
      )}

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
    </FontSettingsProvider>
  );
}
