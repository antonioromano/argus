import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from './context/ThemeContext.js';
import { MobileApp } from './components/mobile/MobileApp.js';
import { Styleguide } from './components/styleguide/Styleguide.js';
import { useSocket, useSocketStatus, reconnectSocket } from './hooks/useSocket.js';
import { useSessions } from './hooks/useSessions.js';
import { useSessionOrder } from './hooks/useSessionOrder.js';
import { useNgrok } from './hooks/useNgrok.js';
import { useUpdate } from './hooks/useUpdate.js';
import { useConfig } from './hooks/useConfig.js';
import { useGitDiff } from './hooks/useGitDiff.js';
import { useNotifications } from './hooks/useNotifications.js';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import { Dashboard } from './components/Dashboard.js';
import { MacUpdateSheet } from './components/mac/MacUpdateSheet.js';
import { PasswordGate } from './components/PasswordGate.js';
import { GitDiffPanel } from './components/GitDiffPanel.js';
import { ExplorerPanel } from './components/ExplorerPanel.js';
import { CommandPalette } from './components/CommandPalette.js';
import { EphemeralTerminal } from './components/EphemeralTerminal.js';
import type { TreeNode } from './hooks/useVirtualTree.js';
import type { AppTab } from './components/NavTabs.js';
import { MobileBottomNav } from './components/MobileBottomNav.js';
import { SidebarSettingsMenu } from './components/SidebarSettingsMenu.js';
import { api, setToken } from './services/api.js';
import { WifiOff, Loader2 } from 'lucide-react';
import { isPrimaryModifier } from './utils/platform.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useResizablePanel } from './hooks/useResizablePanel.js';
import { ResizeDivider } from './components/ResizeDivider.js';
import { MacActivityBar } from './components/mac/MacActivityBar.js';
import { MacSessionSidebar } from './components/mac/MacSessionSidebar.js';
import { MacCreateSessionSheet } from './components/mac/MacCreateSessionSheet.js';
import { MacCloneSessionSheet } from './components/mac/MacCloneSessionSheet.js';
import { showNativeMessageBox } from './utils/nativeDialog.js';
import { MacPreferencesPanel } from './components/mac/MacPreferencesPanel.js';
import { MacRemotePanel } from './components/mac/MacRemotePanel.js';
import { MacUpdateBanner } from './components/mac/MacUpdateBanner.js';
import { ElectronToolbar } from './components/mac/ElectronToolbar.js';

interface DiffState {
  isOpen: boolean;
  isFullscreen: boolean;
}

export default function App() {
  // Mobile companion route — MobileApp handles its own auth flow.
  // Checked via window.location.pathname which is stable per page load,
  // so this conditional never changes between renders and doesn't break hook ordering.
  if (window.location.pathname.startsWith('/mobile')) {
    return <MobileApp />;
  }
  return <AppRoot />;
}

/** Desktop/full app root — separated so App() can dispatch without holding hooks itself. */
function AppRoot() {
  const socket = useSocket();
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Check auth status once on mount
  useEffect(() => {
    api.getAuthStatus().then((status) => {
      setAuthRequired(status.required);
      setAuthenticated(status.authenticated ?? !status.required);
      setAuthChecked(true);
    }).catch(() => {
      // If auth check fails, assume no auth required so local users aren't locked out
      setAuthRequired(false);
      setAuthenticated(true);
      setAuthChecked(true);
    });
  }, []);

  // Listen for auth:required socket event
  useEffect(() => {
    const handleAuthRequired = (payload: { required: boolean }) => {
      setAuthRequired(payload.required);
      if (!payload.required) {
        // Tunnel stopped — clear auth
        setAuthenticated(true);
        setToken(null);
      }
      // When required becomes true, do NOT force authenticated=false.
      // Local user is already authenticated=true; remote user is already false.
    };
    socket.on('auth:required', handleAuthRequired);
    return () => { socket.off('auth:required', handleAuthRequired); };
  }, [socket]);

  // Listen for auth:authenticated (dispatched by startNgrok after storing token)
  useEffect(() => {
    const handler = () => {
      setAuthenticated(true);
      reconnectSocket();
    };
    window.addEventListener('auth:authenticated', handler);
    return () => window.removeEventListener('auth:authenticated', handler);
  }, []);

  // Listen for 401 from API calls
  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  if (!authChecked) return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--color-bg-base)',
    }}>
      <Loader2 size={24} style={{ color: 'var(--color-text-muted)', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (authRequired && !authenticated) {
    return (
      <PasswordGate onAuthenticated={() => {
        setAuthenticated(true);
        reconnectSocket();
      }} />
    );
  }

  return <AppInner />;
}

const BUILTIN_AGENTS = [
  { id: 'claude', name: 'Claude', command: 'claude', builtin: true as const },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', builtin: true as const },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true as const },
];

function AppInner() {
  const { theme, isDark, toggle: toggleTheme } = useTheme();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [explorerState, setExplorerState] = useState<{ selectedFilePath: string | null; searchQuery: string }>({ selectedFilePath: null, searchQuery: '' });
  const [diffStates, setDiffStates] = useState<Map<string, DiffState>>(new Map());
  const [explorerStates, setExplorerStates] = useState<Map<string, DiffState>>(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showNgrokModal, setShowNgrokModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [cloneModalState, setCloneModalState] = useState<{ folderPath: string; agentType?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('sessions');
  const socket = useSocket();
  const socketConnected = useSocketStatus();
  const { sessions, createSession, deleteSession } = useSessions(socket);
  const ngrok = useNgrok(socket);
  const { status: updateStatus } = useUpdate(socket);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [dismissedUpdate, setDismissedUpdate] = useState(false);
  const { config, updateConfig } = useConfig();
  const { getOrderedSessions, reorder } = useSessionOrder();

  // Track mobile viewport — auto-focus mode is always active on mobile
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // --- Folder state persistence caches (plain objects survive tab switches without triggering re-renders) ---
  // Using useState with lazy initializer to get a stable mutable Map that persists across renders.
  // These are intentionally mutated in-place (like refs) but passed as values to avoid lint warnings.
  type SectionKey = 'unstaged' | 'staged' | 'branch' | 'untracked';
  const [treeExpandedPathsCache] = useState(() => new Map<string, Set<string>>());
  const [treeDataCache] = useState(() => new Map<string, Map<string, TreeNode>>());
  const [diffCollapsedSectionsCache] = useState(() => new Map<string, Set<SectionKey>>());

  const handleTreeExpandedPathsChange = useCallback((sessionId: string, paths: Set<string>) => {
    treeExpandedPathsCache.set(sessionId, paths);
  }, [treeExpandedPathsCache]);
  const handleTreeDataChange = useCallback((sessionId: string, data: Map<string, TreeNode>) => {
    treeDataCache.set(sessionId, data);
  }, [treeDataCache]);
  const handleDiffCollapsedSectionsChange = useCallback((sessionId: string, sections: Set<SectionKey>) => {
    diffCollapsedSectionsCache.set(sessionId, sections);
  }, [diffCollapsedSectionsCache]);

  // --- Top-level sidebar (ActivityBar panel) ---
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const {
    size: sidebarWidth,
    isDragging: isSidebarDragging,
    handleMouseDown: handleSidebarMouseDown,
  } = useResizablePanel({
    containerRef: sidebarContainerRef,
    defaultSize: 200,
    minSize: 140,
    maxSize: 360,
    direction: 'right',
    unit: 'px',
    storageKey: 'sidebar-width',
  });

  // --- Shared terminal state ---
  const sharedTerminalContainerRef = useRef<HTMLElement>(document.documentElement);
  const {
    size: sharedTerminalHeight,
    isDragging: isTerminalDragging,
    handleMouseDown: handleTerminalDividerMouseDown,
  } = useResizablePanel({
    containerRef: sharedTerminalContainerRef,
    defaultSize: 200,
    minSize: 100,
    maxSize: 500,
    direction: 'bottom',
    unit: 'px',
    storageKey: 'shared-terminal-height',
  });
  const [sharedTerminalOpen, setSharedTerminalOpen] = useState(false);
  // Track session IDs that have had a terminal spawned (kept alive across session switches)
  const [spawnedTerminalSessions, setSpawnedTerminalSessions] = useState<Set<string>>(new Set());
  const toggleSharedTerminal = useCallback(() => setSharedTerminalOpen(prev => !prev), []);

  // Register the active session's terminal when opened
  useEffect(() => {
    if (!sharedTerminalOpen) return;
    const sid = focusedSessionId ?? sessions[0]?.id;
    if (!sid) return;
    setSpawnedTerminalSessions(prev => {
      if (prev.has(sid)) return prev;
      const next = new Set(prev);
      next.add(sid);
      return next;
    });
  }, [sharedTerminalOpen, focusedSessionId, sessions]);

  // Clean up spawned terminals for deleted sessions
  useEffect(() => {
    const liveIds = new Set(sessions.map(s => s.id));
    setSpawnedTerminalSessions(prev => {
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [sessions]);

  // Set CSS variable for terminal height offset so tab panels can account for it
  useEffect(() => {
    const isTerminalVisible = sharedTerminalOpen && (activeTab === 'explorer' || activeTab === 'git-diff');
    document.documentElement.style.setProperty('--shared-terminal-height', isTerminalVisible ? `${sharedTerminalHeight}px` : '0px');
  }, [sharedTerminalOpen, activeTab, sharedTerminalHeight]);

  // In focus mode the main header is hidden — override --header-height to 0 so layouts fill the viewport
  useEffect(() => {
    if (focusedSessionId) {
      document.documentElement.style.setProperty('--header-height', '0px');
      return () => { document.documentElement.style.removeProperty('--header-height'); };
    }
  }, [focusedSessionId]);

  // Refit terminals when shared terminal resize ends
  const prevTerminalDragging = useRef(false);
  useEffect(() => {
    if (prevTerminalDragging.current && !isTerminalDragging) {
      window.dispatchEvent(new Event('terminal:refit'));
    }
    prevTerminalDragging.current = isTerminalDragging;
  }, [isTerminalDragging]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const refitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRefit = useCallback(() => {
    if (refitTimerRef.current) clearTimeout(refitTimerRef.current);
    refitTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new Event('terminal:refit'));
    }, 150);
  }, []);

  const getDiffState = useCallback(
    (sessionId: string): DiffState => diffStates.get(sessionId) || { isOpen: false, isFullscreen: false },
    [diffStates],
  );

  const setDiffState = useCallback((sessionId: string, update: Partial<DiffState>) => {
    setDiffStates((prev) => {
      const next = new Map(prev);
      const current = next.get(sessionId) || { isOpen: false, isFullscreen: false };
      next.set(sessionId, { ...current, ...update });
      return next;
    });
  }, []);

  const getExplorerState = useCallback(
    (sessionId: string): DiffState => explorerStates.get(sessionId) || { isOpen: false, isFullscreen: false },
    [explorerStates],
  );

  const updateExplorerState = useCallback((sessionId: string, update: Partial<DiffState>) => {
    setExplorerStates((prev) => {
      const next = new Map(prev);
      const current = next.get(sessionId) || { isOpen: false, isFullscreen: false };
      next.set(sessionId, { ...current, ...update });
      return next;
    });
  }, []);

  // Cross-tab navigation: Diff → Explorer (with file pre-selected)
  const handleOpenFileInExplorer = useCallback((absolutePath: string) => {
    setExplorerState({ selectedFilePath: absolutePath, searchQuery: '' });
    setActiveTab('explorer');
  }, []);

  // Cross-tab navigation: Explorer → Diff (optionally with a file to highlight)
  const [diffSearchQuery, setDiffSearchQuery] = useState('');
  const handleOpenDiffView = useCallback((fileName?: string) => {
    setDiffSearchQuery(fileName ?? '');
    setActiveTab('git-diff');
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
    triggerRefit();
  }, [triggerRefit]);


  // Escape key priority: command palette → diff fullscreen → diff close → explorer fullscreen → explorer close → exit focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showCommandPalette) {
        setShowCommandPalette(false);
        return;
      }

      if (focusedSessionId) {
        const ds = getDiffState(focusedSessionId);
        if (ds.isOpen && ds.isFullscreen) {
          setDiffState(focusedSessionId, { isFullscreen: false });
          triggerRefit();
          return;
        }
        if (ds.isOpen) {
          setDiffState(focusedSessionId, { isOpen: false, isFullscreen: false });
          triggerRefit();
          return;
        }
        const es = getExplorerState(focusedSessionId);
        if (es.isOpen && es.isFullscreen) {
          updateExplorerState(focusedSessionId, { isFullscreen: false });
          triggerRefit();
          return;
        }
        if (es.isOpen) {
          updateExplorerState(focusedSessionId, { isOpen: false, isFullscreen: false });
          triggerRefit();
          return;
        }
        setFocusedSessionId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedSessionId, getDiffState, setDiffState, getExplorerState, updateExplorerState, triggerRefit, showCommandPalette]);

  const handleNewSession = useCallback(async () => {
    const path = await api.pickFolder();
    if (path) {
      setPickedFolder(path);
      setShowCreateModal(true);
    }
  }, []);

  const handleCreate = async (folderPath: string, name?: string, agentType?: string, flags?: string[]) => {
    const session = await createSession(folderPath, name, agentType, flags);
    if (isMobile) setFocusedSessionId(session.id);
  };

  const handleClone = useCallback((folderPath: string, agentType?: string) => {
    setCloneModalState({ folderPath, agentType });
  }, []);

  const handleCloneConfirm = async (folderPath: string, agentType: string, flags?: string[]) => {
    const session = await createSession(folderPath, undefined, agentType, flags);
    if (isMobile) setFocusedSessionId(session.id);
  };

  const handleSaveFlag = useCallback(async (agentId: string, flag: import('@argus/shared').AgentFlag) => {
    if (!config) return;
    const current = config.agentFlags?.[agentId] || [];
    await updateConfig({ agentFlags: { ...config.agentFlags, [agentId]: [...current, flag] } });
  }, [config, updateConfig]);

  const handleDelete = useCallback(async (id: string) => {
    const idx = await showNativeMessageBox({
      type: 'warning',
      message: 'Close Session?',
      detail: 'The Claude process will be terminated.',
      buttons: ['Cancel', 'Close Session'],
      cancelId: 0,
      defaultId: 0,
    });
    if (idx !== 1) return;
    if (focusedSessionId === id) {
      const liveIds = new Set(sessions.filter(s => s.id !== id).map(s => s.id));
      let previous: string | null = null;
      while (focusHistoryRef.current.length > 0) {
        const candidate = focusHistoryRef.current.pop()!;
        if (liveIds.has(candidate)) { previous = candidate; break; }
      }
      setFocusedSessionId(previous);
    } else {
      focusHistoryRef.current = focusHistoryRef.current.filter(h => h !== id);
    }
    await deleteSession(id);
  }, [focusedSessionId, sessions, deleteSession]);

  const handleRestart = useCallback(async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (!session || session.status === 'exited') {
      api.restartSession(id);
      return;
    }
    const idx = await showNativeMessageBox({
      type: 'question',
      message: 'Restart Session?',
      detail: 'The running session will be terminated and restarted with the same configuration.',
      buttons: ['Cancel', 'Restart'],
      cancelId: 0,
      defaultId: 0,
    });
    if (idx === 1) await api.restartSession(id);
  }, [sessions]);

  // Stack of previously-focused session ids. When the focused session is closed,
  // we pop the most recent still-alive id instead of exiting focus mode.
  const focusHistoryRef = useRef<string[]>([]);

  // Sessions with pending output the user hasn't seen. A session is marked unread
  // when it transitions into 'idle' while not currently focused; it is cleared on focus.
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const prevStatusesRef = useRef<Map<string, SessionStatus>>(new Map());
  useEffect(() => {
    setUnreadSessions((prev) => {
      const next = new Set(prev);
      let changed = false;
      const liveIds = new Set<string>();
      for (const s of sessions) {
        liveIds.add(s.id);
        const prevStatus = prevStatusesRef.current.get(s.id);
        if (prevStatus && prevStatus !== 'idle' && s.status === 'idle' && s.id !== focusedSessionId) {
          if (!next.has(s.id)) {
            next.add(s.id);
            changed = true;
          }
        }
        prevStatusesRef.current.set(s.id, s.status);
      }
      for (const id of Array.from(next)) {
        if (!liveIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      for (const id of Array.from(prevStatusesRef.current.keys())) {
        if (!liveIds.has(id)) prevStatusesRef.current.delete(id);
      }
      return changed ? next : prev;
    });
  }, [sessions, focusedSessionId]);

  // On mobile, keep focus mode always active — auto-focus first session when none is focused
  useEffect(() => {
    if (isMobile && !focusedSessionId && sessions.length > 0) {
      setFocusedSessionId(sessions[0].id);
    }
  }, [isMobile, focusedSessionId, sessions]);

  const handleFocus = useCallback((id: string) => {
    setUnreadSessions((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setFocusedSessionId((prev) => {
      if (prev !== null && prev !== id) {
        focusHistoryRef.current = focusHistoryRef.current.filter((h) => h !== id);
        focusHistoryRef.current.push(prev);
      }
      return id;
    });
  }, []);

  const handleUnfocus = useCallback(() => {
    focusHistoryRef.current = [];
    setFocusedSessionId(null);
  }, []);

  const handleSwitchToSessionsTab = useCallback(() => {
    setActiveTab('sessions');
  }, []);

  useNotifications({
    sessions,
    enabled: config?.notificationsEnabled ?? false,
    onFocusSession: handleFocus,
    onSwitchToSessionsTab: handleSwitchToSessionsTab,
  });

  const handleToggleDiff = useCallback(
    (sessionId: string) => {
      // On mobile, navigate to the git-diff tab rather than splitting the card
      if (window.innerWidth < 768) {
        setFocusedSessionId(sessionId);
        setActiveTab('git-diff');
        return;
      }
      const ds = getDiffState(sessionId);
      if (ds.isOpen) {
        setDiffState(sessionId, { isOpen: false, isFullscreen: false });
      } else {
        if (focusedSessionId !== sessionId) {
          setFocusedSessionId(sessionId);
        }
        // Mutual exclusivity: close explorer when opening diff
        updateExplorerState(sessionId, { isOpen: false, isFullscreen: false });
        setDiffState(sessionId, { isOpen: true, isFullscreen: false });
      }
      triggerRefit();
    },
    [focusedSessionId, getDiffState, setDiffState, updateExplorerState, triggerRefit],
  );

  const handleToggleDiffFullscreen = useCallback(
    (sessionId: string) => {
      const ds = getDiffState(sessionId);
      setDiffState(sessionId, { isFullscreen: !ds.isFullscreen });
      triggerRefit();
    },
    [getDiffState, setDiffState, triggerRefit],
  );

  const handleCloseDiff = useCallback(
    (sessionId: string) => {
      setDiffState(sessionId, { isOpen: false, isFullscreen: false });
      triggerRefit();
    },
    [setDiffState, triggerRefit],
  );

  const handleToggleExplorer = useCallback(
    (sessionId: string) => {
      // On mobile, navigate to the explorer tab
      if (window.innerWidth < 768) {
        setFocusedSessionId(sessionId);
        setActiveTab('explorer');
        return;
      }
      const es = getExplorerState(sessionId);
      if (es.isOpen) {
        updateExplorerState(sessionId, { isOpen: false, isFullscreen: false });
      } else {
        if (focusedSessionId !== sessionId) {
          setFocusedSessionId(sessionId);
        }
        // Mutual exclusivity: close diff when opening explorer
        setDiffState(sessionId, { isOpen: false, isFullscreen: false });
        updateExplorerState(sessionId, { isOpen: true, isFullscreen: false });
      }
      triggerRefit();
    },
    [focusedSessionId, getExplorerState, updateExplorerState, setDiffState, triggerRefit],
  );

  const orderedSessions = getOrderedSessions(sessions);
  const isStyleguide = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('styleguide');

  const waitingCount = sessions.filter(s => s.status === 'waiting').length;

  useEffect(() => {
    document.title = waitingCount > 0 ? `(${waitingCount}) Argus` : 'Argus';
    window.electronApp?.setBadge(waitingCount);
  }, [waitingCount]);

  // Global keyboard shortcuts.
  // The lists of sessions/handlers may change between renders, so we keep
  // them in a ref to avoid re-binding the listener on every state update.
  const shortcutCtxRef = useRef({
    orderedSessions,
    focusedSessionId,
    handleNewSession,
    handleDelete,
    handleFocus,
    toggleTheme,
  });
  shortcutCtxRef.current = {
    orderedSessions,
    focusedSessionId,
    handleNewSession,
    handleDelete,
    handleFocus,
    toggleTheme,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isPrimaryModifier(e)) return;
      const ctx = shortcutCtxRef.current;

      // Cmd+K — toggle command palette
      if (e.key === 'k' || e.key === 'K') {
        if (e.shiftKey) return; // leave Cmd+Shift+K alone for browser devtools
        e.preventDefault();
        setShowCommandPalette(p => !p);
        return;
      }

      // Cmd+N — new session
      if ((e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault();
        void ctx.handleNewSession();
        return;
      }

      // Cmd+W — close focused session (or unfocus if none)
      if ((e.key === 'w' || e.key === 'W') && !e.shiftKey) {
        e.preventDefault();
        if (ctx.focusedSessionId) {
          void ctx.handleDelete(ctx.focusedSessionId);
        } else {
          setFocusedSessionId(null);
        }
        return;
      }

      // Cmd+, — open settings
      if (e.key === ',') {
        e.preventDefault();
        setShowSettingsModal(true);
        return;
      }

      // Cmd+Shift+L — toggle theme
      if ((e.key === 'l' || e.key === 'L') && e.shiftKey) {
        e.preventDefault();
        ctx.toggleTheme();
        return;
      }

      // Cmd+1..9 — jump to session N (1-indexed)
      if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const target = ctx.orderedSessions[idx];
        if (target) {
          e.preventDefault();
          ctx.handleFocus(target.id);
        }
        return;
      }

      // Cmd+Shift+[ / Cmd+Shift+] — cycle prev/next session
      if (e.shiftKey && (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}')) {
        const list = ctx.orderedSessions;
        if (list.length === 0) return;
        const currentIdx = ctx.focusedSessionId
          ? list.findIndex(s => s.id === ctx.focusedSessionId)
          : -1;
        const direction = e.key === '[' || e.key === '{' ? -1 : 1;
        const nextIdx = currentIdx < 0
          ? (direction > 0 ? 0 : list.length - 1)
          : (currentIdx + direction + list.length) % list.length;
        const target = list[nextIdx];
        if (target) {
          e.preventDefault();
          ctx.handleFocus(target.id);
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Native menu bar → renderer bridges. Subscribe once; the preload's contextBridge
  // returns an unsubscribe function from each onMenu call.
  useEffect(() => {
    const bridge = window.electronApp;
    if (!bridge) return;
    const ctx = shortcutCtxRef;
    const offs = [
      bridge.onMenu('menu:new-session', () => { void ctx.current.handleNewSession(); }),
      bridge.onMenu('menu:close-session', () => {
        if (ctx.current.focusedSessionId) void ctx.current.handleDelete(ctx.current.focusedSessionId);
      }),
      bridge.onMenu('menu:open-settings', () => setShowSettingsModal(true)),
      bridge.onMenu('menu:toggle-palette', () => setShowCommandPalette(p => !p)),
      bridge.onMenu('menu:toggle-theme', () => ctx.current.toggleTheme()),
    ];
    return () => { offs.forEach(off => off()); };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('is-electron');
    return () => { document.documentElement.classList.remove('is-electron'); };
  }, []);

  // Swap the favicon based on session state: green when at least one session is idle, orange otherwise.
  useEffect(() => {
    const hasIdle = sessions.some((s) => s.status === 'idle');
    const href = hasIdle ? '/favicon-green.svg' : '/favicon-orange.svg';
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) {
      link.setAttribute('href', href);
    }
  }, [sessions]);

  if (isStyleguide) {
    return (
      <div style={{ height: '100vh', background: 'var(--color-bg-base)', overflow: 'hidden' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--header-height)',
          padding: '0 var(--space-4)',
          background: 'var(--color-bg-header)',
          borderBottom: '1px solid var(--color-border-base)',
          gap: 'var(--space-3)',
        }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            Argus
          </span>
          <span style={{
            fontSize: 'var(--text-sm)',
            background: 'var(--color-accent-subtle)',
            color: 'var(--color-accent)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontWeight: 500,
          }}>
            Design System
          </span>
        </div>
        <div style={{ height: 'calc(100vh - var(--header-height))', overflowY: 'auto' }}>
          <Styleguide />
        </div>
      </div>
    );
  }

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <ElectronToolbar
        onNewSession={handleNewSession}
        onOpenSettings={() => setShowSettingsModal(true)}
        onToggleTheme={toggleTheme}
        onOpenRemote={() => setShowNgrokModal(true)}
        isDark={isDark}
        ngrokConnected={ngrok.status?.tunnelStatus === 'connected'}
        updateAvailable={updateStatus?.hasUpdate && !dismissedUpdate}
        updateVersion={updateStatus?.latestVersion ?? undefined}
        onOpenUpdate={() => setShowUpdateModal(true)}
      />

      {updateStatus?.hasUpdate && !dismissedUpdate && (
        <MacUpdateBanner
          version={updateStatus.latestVersion ?? ''}
          onUpdate={() => setShowUpdateModal(true)}
          onDismiss={() => setDismissedUpdate(true)}
        />
      )}

      {!socketConnected && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '6px 16px',
            background: 'var(--color-warning-subtle, rgba(255,180,0,0.12))',
            borderBottom: '1px solid var(--color-warning, #f0a500)',
            color: 'var(--color-warning, #f0a500)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <WifiOff size={13} strokeWidth={2} />
          Connection lost — reconnecting…
        </div>
      )}

      {/* macOS-native layout: ActivityBar | Sidebar | ResizeDivider | Content */}
      <div
        id="main-content"
        style={{
          display: 'flex',
          height: 'calc(100vh - var(--header-height))',
          overflow: 'hidden',
        }}
      >
        {/* ActivityBar — leftmost icon strip */}
        <MacActivityBar
          activeView={activeTab}
          onViewChange={setActiveTab}
        />

        {/* Resizable sidebar panel */}
        <div
          ref={sidebarContainerRef}
          style={{
            width: sidebarWidth,
            background: 'var(--color-bg-sidebar, var(--color-bg-surface))',
            borderRight: '0.5px solid var(--color-border-ghost)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {activeTab === 'sessions' && (
            <MacSessionSidebar
              sessions={orderedSessions}
              activeSessionId={focusedSessionId}
              onSelectSession={(id) => {
                handleFocus(id);
              }}
              onReorder={reorder}
              unreadSessions={unreadSessions}
              width={sidebarWidth}
            />
          )}
          {activeTab === 'git-diff' && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              padding: '8px 10px',
              gap: '4px',
            }}>
              <span style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 0',
                flexShrink: 0,
              }}>
                Git Diff
              </span>
              {sessions.map((s) => {
                const isActive = s.id === (focusedSessionId ?? sessions[0]?.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => setFocusedSessionId(s.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: 6,
                      background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      fontSize: 'var(--text-sm)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isActive ? 500 : 400,
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: s.status === 'idle' ? 'var(--color-status-idle)' : s.status === 'exited' ? 'var(--color-status-exited)' : 'var(--color-status-waiting)',
                      flexShrink: 0,
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {s.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {activeTab === 'explorer' && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              padding: '8px 10px',
              gap: '4px',
            }}>
              <span style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 0',
                flexShrink: 0,
              }}>
                Explorer
              </span>
              {sessions.map((s) => {
                const isActive = s.id === focusedSessionId;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleFocus(s.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      padding: '4px 8px',
                      border: 'none',
                      borderRadius: 6,
                      background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      fontSize: 'var(--text-sm)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isActive ? 500 : 400,
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: s.status === 'idle' ? 'var(--color-status-idle)' : s.status === 'exited' ? 'var(--color-status-exited)' : 'var(--color-status-waiting)',
                      flexShrink: 0,
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {s.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Divider between sidebar and content */}
        <ResizeDivider
          isDragging={isSidebarDragging}
          onMouseDown={handleSidebarMouseDown}
          orientation="vertical"
        />

        {/* Main content area — flex:1, contains tab panels */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          <div style={{ display: activeTab === 'sessions' ? 'contents' : 'none' }}>
            <ErrorBoundary variant="tab" label="Sessions">
              <div role="tabpanel" id="tabpanel-sessions" aria-labelledby="tab-sessions" style={{ display: 'contents' }}>
                <Dashboard
                  hideSidebar
                  sessions={orderedSessions}
                  socket={socket}
                  theme={theme}
                  onDeleteSession={handleDelete}
                  onRestartSession={handleRestart}
                  onCreateSession={handleNewSession}
                  onCloneSession={handleClone}
                  onReorder={reorder}
                  focusedSessionId={focusedSessionId}
                  onFocusSession={handleFocus}
                  onUnfocusSession={handleUnfocus}
                  getDiffState={getDiffState}
                  onToggleDiff={handleToggleDiff}
                  onToggleDiffFullscreen={handleToggleDiffFullscreen}
                  onCloseDiff={handleCloseDiff}
                  getExplorerState={getExplorerState}
                  onToggleExplorer={handleToggleExplorer}
                  unreadSessions={unreadSessions}
                  sidebarSettingsMenu={
                    <SidebarSettingsMenu
                      isDark={isDark}
                      isFullscreen={isFullscreen}
                      ngrokConnected={ngrok.status?.tunnelStatus === 'connected'}
                      onOpenSettings={() => setShowSettingsModal(true)}
                      onToggleFullscreen={toggleFullscreen}
                      onOpenRemote={() => setShowNgrokModal(true)}
                      onToggleTheme={toggleTheme}
                    />
                  }
                />
              </div>
            </ErrorBoundary>
          </div>
          <div style={{ display: activeTab === 'git-diff' ? 'contents' : 'none' }}>
            <div role="tabpanel" id="tabpanel-git-diff" aria-labelledby="tab-git-diff" style={{ display: 'contents' }}>
              {sessions.length > 0 ? (
                <ErrorBoundary variant="tab" label="Git Diff">
                  <GlobalGitDiffView
                    sessionId={focusedSessionId ?? sessions[0].id}
                    sessionStatus={sessions.find(s => s.id === (focusedSessionId ?? sessions[0].id))?.status ?? 'idle'}
                    theme={theme}
                    sessions={sessions}
                    currentSessionId={focusedSessionId ?? sessions[0].id}
                    onSelectSession={setFocusedSessionId}
                    onOpenInExplorer={handleOpenFileInExplorer}
                    initialSearchQuery={diffSearchQuery}
                    diffCollapsedSectionsCache={diffCollapsedSectionsCache}
                    onCollapsedSectionsChange={handleDiffCollapsedSectionsChange}
                    showTerminal={sharedTerminalOpen}
                    onToggleTerminal={toggleSharedTerminal}
                    showSessionSelector={false}
                  />
                </ErrorBoundary>
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: `calc(100vh - var(--header-height) - var(--nav-tabs-height) - var(--shared-terminal-height, 0px))`,
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-md)',
                }}>
                  No sessions — create a session to view git diff
                </div>
              )}
            </div>
          </div>
          <div style={{ display: activeTab === 'explorer' ? 'contents' : 'none' }}>
            <div role="tabpanel" id="tabpanel-explorer" aria-labelledby="tab-explorer" style={{ display: 'contents' }}>
              <ErrorBoundary variant="tab" label="Explorer">
                <ExplorerPanel
                  embedded
                  sessions={orderedSessions}
                  theme={theme}
                  onSelectSession={handleFocus}
                  focusedSessionId={focusedSessionId}
                  initialFilePath={explorerState.selectedFilePath}
                  initialSearchQuery={explorerState.searchQuery}
                  onExplorerStateChange={setExplorerState}
                  socket={socket}
                  onOpenInDiff={handleOpenDiffView}
                  treeExpandedPaths={treeExpandedPathsCache}
                  treeDataCache={treeDataCache}
                  onTreeExpandedPathsChange={handleTreeExpandedPathsChange}
                  onTreeDataChange={handleTreeDataChange}
                  showTerminal={sharedTerminalOpen}
                  onToggleTerminal={toggleSharedTerminal}
                />
              </ErrorBoundary>
            </div>
          </div>

        </div>
      </div>

      {/* Shared terminals — one per session, kept alive across session/tab switches */}
      {sharedTerminalOpen && (() => {
        const activeSid = focusedSessionId ?? sessions[0]?.id;
        const isAnyActive = activeSid && (activeTab === 'explorer' || activeTab === 'git-diff');
        return (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${sharedTerminalHeight}px`,
              zIndex: 50,
              background: 'var(--color-bg-base)',
              display: isAnyActive ? 'flex' : 'none',
              flexDirection: 'column',
              cursor: isTerminalDragging ? 'row-resize' : undefined,
              userSelect: isTerminalDragging ? 'none' : undefined,
            }}
          >
            <ResizeDivider
              isDragging={isTerminalDragging}
              onMouseDown={handleTerminalDividerMouseDown}
              orientation="horizontal"
            />
            {Array.from(spawnedTerminalSessions).map(sid => {
              const session = sessions.find(s => s.id === sid);
              if (!session?.folderPath) return null;
              const isActive = sid === activeSid;
              return (
                <div
                  key={sid}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: isActive ? 'flex' : 'none',
                    flexDirection: 'column',
                  }}
                >
                  <EphemeralTerminal cwd={session.folderPath} socket={socket} theme={theme} onClose={toggleSharedTerminal} />
                </div>
              );
            })}
          </div>
        );
      })()}

      <MacCreateSessionSheet
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setPickedFolder(null); }}
        onCreate={handleCreate}
        theme={theme}
        initialFolderPath={pickedFolder}
        defaultAgentType={config?.defaultAgent}
        agents={config ? [...BUILTIN_AGENTS, ...config.customAgents] : []}
        agentFlags={config?.agentFlags}
        onSaveFlag={handleSaveFlag}
      />

      <MacCloneSessionSheet
        isOpen={!!cloneModalState}
        folderPath={cloneModalState?.folderPath ?? ''}
        currentAgentType={cloneModalState?.agentType}
        defaultAgentType={config?.defaultAgent}
        agents={config ? [...BUILTIN_AGENTS, ...config.customAgents] : []}
        theme={theme}
        onClone={handleCloneConfirm}
        onClose={() => setCloneModalState(null)}
        agentFlags={config?.agentFlags}
        onSaveFlag={handleSaveFlag}
      />

      {config && (
        <MacPreferencesPanel
          isOpen={showSettingsModal}
          config={config}
          onClose={() => setShowSettingsModal(false)}
          onSave={updateConfig}
          version={updateStatus?.currentVersion}
          onOpenRemote={() => { setShowSettingsModal(false); setShowNgrokModal(true); }}
        />
      )}

      <MacRemotePanel
        isOpen={showNgrokModal}
        onClose={() => setShowNgrokModal(false)}
        status={ngrok.status}
        loading={ngrok.loading}
        error={ngrok.error}
        onStart={ngrok.startTunnel}
        onStop={ngrok.stopTunnel}
        onRecheck={ngrok.recheckInstallation}
      />

      {showUpdateModal && updateStatus && (
        <MacUpdateSheet
          status={updateStatus}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      <MobileBottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewSession={handleNewSession}
        onSettings={() => setShowSettingsModal(true)}
      />

      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        sessions={sessions}
        focusedSessionId={focusedSessionId}
        onOpenInExplorer={(filePath) => {
          setExplorerState({ selectedFilePath: filePath, searchQuery: '' });
          setActiveTab('explorer');
          setShowCommandPalette(false);
        }}
        onOpenInDiff={(fileName) => {
          handleOpenDiffView(fileName);
          setShowCommandPalette(false);
        }}
        theme={theme}
      />
    </>
  );
}

/** Full-width git diff view for the Git Diff tab. */
function GlobalGitDiffView({
  sessionId,
  sessionStatus,
  theme,
  sessions,
  currentSessionId,
  onSelectSession,
  onOpenInExplorer,
  initialSearchQuery,
  diffCollapsedSectionsCache,
  onCollapsedSectionsChange,
  showTerminal,
  onToggleTerminal,
  showSessionSelector = true,
}: {
  sessionId: string;
  sessionStatus: string;
  theme: 'dark' | 'light';
  sessions: SessionInfo[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onOpenInExplorer?: (absolutePath: string) => void;
  initialSearchQuery?: string;
  diffCollapsedSectionsCache: Map<string, Set<'unstaged' | 'staged' | 'branch' | 'untracked'>>;
  onCollapsedSectionsChange: (sessionId: string, sections: Set<'unstaged' | 'staged' | 'branch' | 'untracked'>) => void;
  showTerminal?: boolean;
  onToggleTerminal?: () => void;
  showSessionSelector?: boolean;
}) {
  const { diff, isLoading, error, refresh, expandFileContext, expandingFiles } = useGitDiff({
    sessionId,
    isOpen: true,
    sessionStatus: sessionStatus as 'running' | 'waiting' | 'idle' | 'exited',
  });

  return (
    <div style={{ height: `calc(100vh - var(--header-height) - var(--nav-tabs-height) - var(--shared-terminal-height, 0px))`, display: 'flex' }}>
      <GitDiffPanel
        diff={diff}
        theme={theme}
        isLoading={isLoading}
        error={error}
        isFullscreen={false}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={onSelectSession}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
        onRefresh={refresh}
        showHeaderControls={false}
        showSessionSelector={showSessionSelector}
        onOpenInExplorer={onOpenInExplorer}
        initialSearchQuery={initialSearchQuery}
        initialCollapsedSections={diffCollapsedSectionsCache.get(currentSessionId)}
        onCollapsedSectionsChange={(sections) => onCollapsedSectionsChange(currentSessionId, sections)}
        showTerminal={showTerminal}
        onToggleTerminal={onToggleTerminal}
        onExpandFileContext={expandFileContext}
        expandingFiles={expandingFiles}
      />
    </div>
  );
}

