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
import { CreateSessionModal } from './components/CreateSessionModal.js';
import { CloneSessionModal } from './components/CloneSessionModal.js';
import { NgrokModal } from './components/NgrokModal.js';
import { UpdateModal } from './components/UpdateModal.js';
import { MacUpdateSheet } from './components/mac/MacUpdateSheet.js';
import { SettingsModal } from './components/SettingsModal.js';
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
import { WifiOff, Settings, Maximize2, Minimize2, Globe, ArrowUpCircle, Sun, Moon, Loader2, Terminal, GitBranch, FolderOpen } from 'lucide-react';

// True when running inside the Electron desktop app.
// Used to gate the macOS-native layout so browser users get the original UI.
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useResizablePanel } from './hooks/useResizablePanel.js';
import { ResizeDivider } from './components/ResizeDivider.js';
import { MacActivityBar } from './components/mac/MacActivityBar.js';
import { MacSessionSidebar } from './components/mac/MacSessionSidebar.js';
import { MacCreateSessionSheet } from './components/mac/MacCreateSessionSheet.js';
import { MacCloneSessionSheet } from './components/mac/MacCloneSessionSheet.js';
import { MacAlertSheet } from './components/mac/MacAlertSheet.js';
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingRestartId, setPendingRestartId] = useState<string | null>(null);
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

  // Cmd+K opens command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(p => !p);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

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

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const handleRestart = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id);
    if (!session || session.status === 'exited') {
      api.restartSession(id);
    } else {
      setPendingRestartId(id);
    }
  }, [sessions]);

  const handleRestartConfirm = useCallback(async () => {
    if (!pendingRestartId) return;
    await api.restartSession(pendingRestartId);
    setPendingRestartId(null);
  }, [pendingRestartId]);

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

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDeleteId) return;
    if (focusedSessionId === pendingDeleteId) {
      const liveIds = new Set(sessions.filter((s) => s.id !== pendingDeleteId).map((s) => s.id));
      let previous: string | null = null;
      while (focusHistoryRef.current.length > 0) {
        const candidate = focusHistoryRef.current.pop()!;
        if (liveIds.has(candidate)) {
          previous = candidate;
          break;
        }
      }
      setFocusedSessionId(previous);
    } else {
      focusHistoryRef.current = focusHistoryRef.current.filter((h) => h !== pendingDeleteId);
    }
    await deleteSession(pendingDeleteId);
    setPendingDeleteId(null);
  }, [pendingDeleteId, focusedSessionId, sessions, deleteSession]);

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
  }, [waitingCount]);

  useEffect(() => {
    if (isElectron) document.documentElement.classList.add('is-electron');
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

  const ngrokBorderColor = ngrok.status?.tunnelStatus === 'connected'
    ? 'var(--color-success)'
    : 'var(--color-border-subtle)';
  const ngrokColor = ngrok.status?.tunnelStatus === 'connected'
    ? 'var(--color-success)'
    : 'var(--color-text-secondary)';

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

      {/* Toolbar: macOS-native in Electron, browser header otherwise */}
      {isElectron ? (
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
      ) : !focusedSessionId && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 'var(--header-height)',
            padding: '0 var(--space-4)',
            paddingLeft: isElectron ? '80px' : 'var(--space-4)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            background: 'var(--color-bg-deepest)',
            borderBottom: 'none',
            gap: 'var(--space-1)',
            flexShrink: 0,
            ...(isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}),
          }}
        >
          {/* Brand */}
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text-primary)', marginRight: 'var(--space-3)', ...(isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}) }}>
            Argus
          </span>

          {/* Inline tab buttons — browser only (Electron uses ActivityBar) */}
          {!isElectron && ([
            { id: 'sessions' as AppTab, label: 'Terminal Sessions', icon: Terminal },
            { id: 'git-diff' as AppTab, label: 'Git Diff', icon: GitBranch },
            { id: 'explorer' as AppTab, label: 'Explorer', icon: FolderOpen },
          ]).map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={!isActive ? 'hover-bg-surface' : ''}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '0 12px',
                  height: '32px',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  background: isActive ? 'var(--color-surface-highest)' : 'transparent',
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-base)',
                  fontWeight: isActive ? 600 : 400,
                  fontFamily: 'var(--font-sans)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  borderRadius: 'var(--radius-sm)',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={13} strokeWidth={1.75} />
                {tab.label}
                {tab.id === 'sessions' && waitingCount > 0 && (
                  <span style={{
                    fontSize: 'var(--text-xs)',
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: 'var(--color-status-waiting)',
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-pill)',
                    fontWeight: 600,
                  }}>{waitingCount}</span>
                )}
              </button>
            );
          })}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', ...(isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}) }}>
            {/* Settings — hidden on mobile (moved to bottom nav) */}
            <span className="header-settings-btn">
              <HeaderButton onClick={() => setShowSettingsModal(true)} title="Settings">
                <Settings size={15} strokeWidth={1.75} />
              </HeaderButton>
            </span>

            {/* Fullscreen — hidden on mobile (Fullscreen API unsupported on iOS) */}
            <span className="header-fullscreen-btn">
              <HeaderButton onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                {isFullscreen ? <Minimize2 size={15} strokeWidth={1.75} /> : <Maximize2 size={15} strokeWidth={1.75} />}
              </HeaderButton>
            </span>

            {/* Remote access */}
            <HeaderButton
              onClick={() => setShowNgrokModal(true)}
              title={ngrok.status?.tunnelStatus === 'connected' ? `Remote: ${ngrok.status.publicUrl}` : 'Remote Access'}
              style={{ position: 'relative', borderColor: ngrokBorderColor, color: ngrokColor }}
            >
              <Globe size={15} strokeWidth={1.75} />
              {ngrok.status?.tunnelStatus === 'connected' && (
                <span style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-3px',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: 'var(--color-success)',
                  border: '2px solid var(--color-bg-header)',
                }} />
              )}
            </HeaderButton>

            {/* Update available */}
            {updateStatus?.hasUpdate && (
              <HeaderButton
                onClick={() => setShowUpdateModal(true)}
                title={`Update available: v${updateStatus.latestVersion}`}
                style={{ position: 'relative', borderColor: 'var(--color-success)', color: 'var(--color-success)' }}
              >
                <ArrowUpCircle size={15} strokeWidth={1.75} />
                <span style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-3px',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: 'var(--color-success)',
                  border: '2px solid var(--color-bg-header)',
                }} />
              </HeaderButton>
            )}

            {/* Theme toggle */}
            <HeaderButton onClick={toggleTheme} title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
              {isDark ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
            </HeaderButton>

            {/* New Session */}
            <button
              onClick={handleNewSession}
              className="hover-opacity"
              style={{
                padding: '0 14px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                fontSize: 'var(--text-md)',
                border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-btn-primary-bg)',
                color: 'var(--color-btn-primary-text)',
                cursor: 'pointer',
                fontWeight: 600,
                gap: '6px',
                transition: 'opacity var(--transition-fast)',
              }}
            >
              + New Session
            </button>
          </div>
        </header>
      )}

      {isElectron && updateStatus?.hasUpdate && !dismissedUpdate && (
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

      {/* Browser layout: simple tab panels (no ActivityBar, no sidebar) */}
      {!isElectron && (
        <div id="main-content" style={{ height: 'calc(100vh - var(--header-height))', overflow: 'hidden' }}>
          <div style={{ display: activeTab === 'sessions' ? 'contents' : 'none' }}>
            <ErrorBoundary variant="tab" label="Sessions">
              <div role="tabpanel" id="tabpanel-sessions" aria-labelledby="tab-sessions" style={{ display: 'contents' }}>
                <Dashboard
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
                  />
                </ErrorBoundary>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100vh - var(--header-height))`, color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
                  No sessions — create a session to view git diff
                </div>
              )}
            </div>
          </div>
          <div style={{ display: activeTab === 'explorer' ? 'contents' : 'none' }}>
            <div role="tabpanel" id="tabpanel-explorer" aria-labelledby="tab-explorer" style={{ display: 'contents' }}>
              <ErrorBoundary variant="tab" label="Explorer">
                <ExplorerPanel
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
      )}

      {/* macOS-native layout (Electron only): ActivityBar | Sidebar | ResizeDivider | Content */}
      {isElectron && (
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
      )} {/* end isElectron macOS layout */}

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

      {isElectron ? (
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
      ) : showCreateModal && (
        <CreateSessionModal
          onClose={() => { setShowCreateModal(false); setPickedFolder(null); }}
          onCreate={handleCreate}
          theme={theme}
          initialFolderPath={pickedFolder}
          defaultAgentType={config?.defaultAgent}
          agents={config ? [...BUILTIN_AGENTS, ...config.customAgents] : []}
          agentFlags={config?.agentFlags}
          onSaveFlag={handleSaveFlag}
        />
      )}

      {isElectron ? (
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
      ) : cloneModalState && (
        <CloneSessionModal
          folderPath={cloneModalState.folderPath}
          currentAgentType={cloneModalState.agentType}
          defaultAgentType={config?.defaultAgent}
          agents={config ? [...BUILTIN_AGENTS, ...config.customAgents] : []}
          theme={theme}
          onClone={handleCloneConfirm}
          onClose={() => setCloneModalState(null)}
          agentFlags={config?.agentFlags}
          onSaveFlag={handleSaveFlag}
        />
      )}

      {isElectron ? config && (
        <MacPreferencesPanel
          isOpen={showSettingsModal}
          config={config}
          onClose={() => setShowSettingsModal(false)}
          onSave={updateConfig}
          version={updateStatus?.currentVersion}
          onOpenRemote={() => { setShowSettingsModal(false); setShowNgrokModal(true); }}
        />
      ) : showSettingsModal && config && (
        <SettingsModal
          config={config}
          onClose={() => setShowSettingsModal(false)}
          onSave={updateConfig}
          theme={theme}
          version={updateStatus?.currentVersion}
        />
      )}

      {isElectron ? (
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
      ) : showNgrokModal && (
        <NgrokModal
          onClose={() => setShowNgrokModal(false)}
          theme={theme}
          status={ngrok.status}
          loading={ngrok.loading}
          error={ngrok.error}
          onStart={ngrok.startTunnel}
          onStop={ngrok.stopTunnel}
          onRecheck={ngrok.recheckInstallation}
        />
      )}

      {showUpdateModal && updateStatus && (
        isElectron ? (
          <MacUpdateSheet
            status={updateStatus}
            onClose={() => setShowUpdateModal(false)}
          />
        ) : (
          <UpdateModal
            status={updateStatus}
            onClose={() => setShowUpdateModal(false)}
          />
        )
      )}

      {isElectron ? (
        <>
          <MacAlertSheet
            isOpen={!!pendingDeleteId}
            title="Close Session?"
            message="The Claude process will be terminated."
            confirmLabel="Close Session"
            confirmDestructive
            onConfirm={handleDeleteConfirm}
            onCancel={() => setPendingDeleteId(null)}
          />
          <MacAlertSheet
            isOpen={!!pendingRestartId}
            title="Restart Session?"
            message="The running session will be terminated and restarted with the same configuration."
            confirmLabel="Restart"
            onConfirm={handleRestartConfirm}
            onCancel={() => setPendingRestartId(null)}
          />
        </>
      ) : (
        <>
          {/* Confirm delete dialog */}
          {pendingDeleteId && (
            <div
              onClick={() => setPendingDeleteId(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-modal-top)' as unknown as number }}
            >
              <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-modal)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', width: '360px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', border: '1px solid var(--color-border-base)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Close Session?</h3>
                <p style={{ margin: '0 0 20px', fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)' }}>The Claude process will be terminated.</p>
                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                  <button onClick={() => setPendingDeleteId(null)} style={{ padding: '8px 16px', fontSize: 'var(--text-md)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                  <button autoFocus onClick={handleDeleteConfirm} style={{ padding: '8px 16px', fontSize: 'var(--text-md)', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-error)', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>Close Session</button>
                </div>
              </div>
            </div>
          )}
          {/* Confirm restart dialog */}
          {pendingRestartId && (
            <div
              onClick={() => setPendingRestartId(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-modal-top)' as unknown as number }}
            >
              <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-modal)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', width: '360px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', border: '1px solid var(--color-border-base)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Restart Session?</h3>
                <p style={{ margin: '0 0 20px', fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)' }}>The running session will be terminated and restarted with the same configuration.</p>
                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                  <button onClick={() => setPendingRestartId(null)} style={{ padding: '8px 16px', fontSize: 'var(--text-md)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Cancel</button>
                  <button autoFocus onClick={handleRestartConfirm} style={{ padding: '8px 16px', fontSize: 'var(--text-md)', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>Restart</button>
                </div>
              </div>
            </div>
          )}
        </>
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

/** Small icon button used in the app header. */
function HeaderButton({
  onClick,
  title,
  children,
  style,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="ghost-border hover-bg-surface"
      style={{
        background: 'none',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        padding: '0',
        width: '32px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: 'var(--text-md)',
        color: 'var(--color-text-secondary)',
        transition: 'background var(--transition-fast)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
