import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../context/theme-context.js';
import { useSystemAppearance } from '../hooks/useSystemAppearance.js';
import { DensityProvider } from '../context/DensityContext.js';
import { DENSITY_METRICS, DEFAULT_DENSITY, isDensity } from '../tokens/density.js';
import { FontSettingsProvider } from '../context/FontSettingsContext.js';
import { useSocket, useSocketStatus, reconnectSocket } from '../hooks/useSocket.js';
import { useSessions } from '../hooks/useSessions.js';
import { useSessionOrder } from '../hooks/useSessionOrder.js';
import { useMosaicOrder } from '../hooks/useMosaicOrder.js';
import { useGroups, OTHERS_GROUP_ID } from '../hooks/useGroups.js';
import { useConfig } from '../hooks/useConfig.js';
import { useNgrok } from '../hooks/useNgrok.js';
import { useKeepAwake } from '../hooks/useKeepAwake.js';
import { usePlanUsage } from '../hooks/usePlanUsage.js';
import { usageMeterView, type UsageMeterState } from '../utils/usageFormat.js';
import { useUpdate } from '../hooks/useUpdate.js';
import { useNotifications } from '../hooks/useNotifications.js';
import { clearScrollback, openNativeFindBar } from '../hooks/useTerminal.js';
import { api, setToken } from '../services/api.js';
import { checkOrphansOnStartup } from '../hooks/orphanStartupCheck.js';
import { useShortcuts } from '../keyboard/useShortcuts.js';
import type { AgentFlag, InspectorSide, SessionInfo, BroadcastRequest, BroadcastResult, AppConfig, SessionGroup, FavoriteEntryMeta, WorktreeMergePreviewResponse, TerminalEngine, RunMode } from '@argus/shared';
import { FAVORITES_GROUP_ID, MAIN_WINDOW_ID } from '@argus/shared';
import { resolveGroupColor } from '../constants/groupColors.js';
import { WifiOff, Plus } from 'lucide-react';
import { LaunchCardStack } from './ui/LaunchCardStack.js';
import { focusPendingLaunch, hasPendingLaunch } from './ui/launchFocus.js';
import { AlertSheet, Button, ToastProvider, pushToast, Tooltip, Icon, Spinner, Row } from '../components/primitives/index.js';
import { registerErrorActionHost } from '../errors/errorActions.js';
import { toastError } from '../errors/toastError.js';
import { deferUndoable, offerUndo } from '../utils/undoable.js';
import { closeShellMode, closeThenOfferReopen, groupSlotOf, reopenRequest } from './closeShellFlow.js';

import { MobileApp } from './mobile/MobileApp.js';
import { PasswordGate } from './PasswordGate.js';
import { WindowChrome } from './ui/WindowChrome.js';
import { ElectronToolbar } from './ui/ElectronToolbar.js';
import { AppStatusBar } from './ui/AppStatusBar.js';
import { useBackendHealth } from '../hooks/useBackendHealth.js';
import { Sidebar } from './ui/Sidebar.js';
import { readSidebarCollapsed } from './ui/sidebarState.js';
import { SessionInspector } from './inspector/SessionInspector.js';
import { InspectorColumn } from './inspector/InspectorColumn.js';
import type { InspectorContext } from './inspector/types.js';
import { SessionTree } from './ui/SessionTree.js';
import { SessionMenuProvider } from './ui/SessionMenuProvider.js';
import { TopToolbar } from './ui/TopToolbar.js';
import { Mosaic } from './views/Mosaic.js';
import { Focus } from './views/Focus.js';
import { Overlay } from './overlays/Overlay.js';
import { CreateSheet } from './overlays/CreateSheet.js';
import { CloneSheet } from './overlays/CloneSheet.js';
import { RegistryPalette } from './overlays/RegistryPalette.js';
import { WaitingInbox } from './overlays/WaitingInbox.js';
import { SessionSearch } from './overlays/SessionSearch.js';
import { requestTerminalReveal } from '../hooks/terminalReveal.js';
import { BroadcastSheet } from './overlays/BroadcastSheet.js';
import { formatCombo } from '../keyboard/combo.js';
import { activeScopes, scopedHandler, createMenuEchoGuard, createDedupeGate } from '../keyboard/scopes.js';
import { useMenuCommandHandlers } from '../commands/useMenuCommandHandlers.js';
import { invokeMenu } from '../commands/menuBridge.js';
import type { CommandContext } from '../commands/sources/index.js';
import { UpdateSheet } from './overlays/UpdateSheet.js';
import { QuickActionSheet } from './overlays/QuickActionSheet.js';
import { shouldPromptQuickAction } from '../utils/quickActionPrompt.js';
import { introConfigPatch, introDiscoveryPatch, introToShow } from './intro/intro.js';
import { IntroSheet, type IntroResult } from './intro/IntroSheet.js';
import { ShortcutsSheet } from './overlays/ShortcutsSheet.js';
import { AboutSheet } from './overlays/AboutSheet.js';
import { runHelpAction } from './helpActions.js';
import { useDiscovery } from './discovery/useDiscovery.js';
import { DiscoveryHost } from './discovery/DiscoveryHost.js';
import { emitDiscovery } from './discovery/discoveryEvents.js';
import type { TipAction } from './discovery/tips.js';
import { GettingStarted } from './discovery/GettingStarted.js';
import type { ChecklistId } from './discovery/checklist.js';
import { HIDE_ALL_PROMOS, promosFor, runBetaPromo, templatesPromoVisible, type BetaPromo } from './discovery/betaPromos.js';
import { DEFAULT_TILE_QUICK_ACTION } from '../constants/tileActions.js';
import { SettingsOverlay } from './overlays/SettingsOverlay.js';
import { MergePreviewSheet } from './overlays/MergePreviewSheet.js';
import { FinishWorktreeHost } from './overlays/FinishWorktreeSheet.js';
import { HandoffHost } from './overlays/HandoffSheet.js';
import { ChainHost } from './overlays/ChainSheet.js';
import { useChains } from '../hooks/useChains.js';
import { isBetaEnabled } from '../utils/betaFlags.js';
import { SessionPickerSheet } from './overlays/SessionPickerSheet.js';
import { useAppView } from './state/useAppView.js';
import { consumeFreshLaunch, loadGroupFilter, persistGroupFilter } from './state/windowUiState.js';
import { useMosaicVisibility } from './state/useMosaicVisibility.js';
import { useWindows } from '../hooks/useWindows.js';
import { insertBefore } from '../utils/reorder.js';
import { deriveCounts } from './types.js';
import type { SidebarKey } from './types.js';
import { setSuppressionTransport } from '../hooks/nativeOverlayRegistry.js';
import { canResume } from '../utils/resume.js';

interface NativeTerminalSuppressionBridge {
  suppress: (sessionId: string) => void;
  unsuppress: (sessionId: string) => void;
}

export default function ArgusApp() {
  // Pause infinite background animations (waiting pulses, sweeps, marquee, landing
  // glow) while the window is hidden. They otherwise repaint forever on
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

  // Wire the overlay-suppression registry to the native-terminal IPC bridge,
  // once, for the app's lifetime. A child NSWindow always paints above its
  // parent's web content, so a DOM surface (modal, menu, tooltip...) that
  // covers a native terminal overlay must hide it for as long as it's shown —
  // see useOverlaySuppression. `electronNativeTerminal` is only defined inside
  // Electron (absent in dev:web/jsdom); with the native-terminal flag unset it
  // is still always exposed, but suppress/unsuppress are no-ops all the way
  // down (NativeTerminalHost.hide/show short-circuit on a null addon), so no
  // extra guard is needed beyond "does the bridge exist at all".
  useEffect(() => {
    const api = (window as Window & { electronNativeTerminal?: NativeTerminalSuppressionBridge }).electronNativeTerminal;
    if (!api) return;
    setSuppressionTransport({ hide: api.suppress, show: api.unsuppress });
  }, []);

  if (!authChecked) {
    return (
      <Row justify="center" style={{ height: '100vh', background: 'var(--bg-0)' }}>
        <Spinner size={24} color="var(--fg-3)" />
      </Row>
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

/** Stable empty default for AppConfig.inspectorCollapsed. */
const NO_SECTIONS: readonly string[] = [];

function DesktopInner() {
  const { theme, isDark, mode: themeMode, setMode: setThemeMode, toggle: toggleTheme } = useTheme();
  const socket = useSocket();
  const socketConnected = useSocketStatus();
  const { sessions, loaded: sessionsLoaded, loadError: sessionsLoadError, retry: retrySessionsLoad, createSession, adoptSession, deleteSession, renameSession, reopenSession, hideSession, unhideSession, commitClose } = useSessions(socket);
  const ngrok = useNgrok(socket);
  const keepAwake = useKeepAwake(socket);
  const backendHealth = useBackendHealth(socket);
  const { status: updateStatus, progress: updateProgress, failure: updateFailure, resetUpdateState } = useUpdate(socket);
  const { config, updateConfig } = useConfig();
  // Plan 009 S2: on by default; config loads after first paint, so treat
  // "not loaded yet" as on rather than flashing the bar in.
  const showStatusBar = config?.showStatusBar ?? true;
  // macOS appearance → <html> (material, contrast, active window, accent);
  // the density's toolbar height re-centres the traffic lights.
  useSystemAppearance(theme, {
    titlebarH: DENSITY_METRICS[isDensity(config?.density) ? config.density : DEFAULT_DENSITY].titlebarH,
  });
  // Usage meter: one stable object for every shell header (tiles are memoized).
  const meterView = useMemo(() => usageMeterView(config), [config]);
  const planUsage = usePlanUsage(socket, meterView !== null);
  const usageMeter = useMemo<UsageMeterState | null>(
    () => (meterView ? { ...meterView, plans: planUsage } : null),
    [meterView, planUsage],
  );
  // Session Inspector (usage, git, GitHub of the shown shell). Visibility,
  // side, width and collapsed sections are AppConfig, so they survive restarts.
  const inspectorVisible = config?.inspectorVisible !== false;
  const inspectorSide: InspectorSide = config?.inspectorSide === 'right' ? 'right' : 'left';
  const inspectorCollapsed = config?.inspectorCollapsed ?? NO_SECTIONS;
  // The values the last change asked for. Config only updates when the PUT
  // returns, so two quick clicks computed from it would both start from the
  // same stale value and the second would undo the first.
  const inspectorIntent = useRef({ visible: inspectorVisible, side: inspectorSide, collapsed: inspectorCollapsed });
  useEffect(() => {
    inspectorIntent.current = { visible: inspectorVisible, side: inspectorSide, collapsed: inspectorCollapsed };
  }, [inspectorVisible, inspectorSide, inspectorCollapsed]);
  // On the left the inspector lives in the sidebar, so a collapsed sidebar
  // hides it — and the shell header takes its chips back. Seeded from the
  // sidebar's own stored state so the first render already agrees with it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [sidebarExpandRequest, setSidebarExpandRequest] = useState(0);
  const switchInspectorSide = useCallback(() => {
    const side: InspectorSide = inspectorIntent.current.side === 'left' ? 'right' : 'left';
    inspectorIntent.current = { ...inspectorIntent.current, side };
    // Moving it into a collapsed sidebar would make it vanish: open the sidebar too.
    if (side === 'left' && sidebarCollapsed && inspectorIntent.current.visible) setSidebarExpandRequest((n) => n + 1);
    updateConfig({ inspectorSide: side }).catch(console.error);
  }, [updateConfig, sidebarCollapsed]);
  const toggleInspector = useCallback(() => {
    const { visible: wasVisible, side } = inspectorIntent.current;
    // On the left a collapsed sidebar hides it anyway: reveal it instead of
    // hiding something that isn't on screen.
    if (side === 'left' && sidebarCollapsed) {
      setSidebarExpandRequest((n) => n + 1);
      if (wasVisible) return;
    }
    inspectorIntent.current = { ...inspectorIntent.current, visible: !wasVisible };
    updateConfig({ inspectorVisible: !wasVisible }).catch(console.error);
  }, [updateConfig, sidebarCollapsed]);
  const toggleInspectorSection = useCallback((id: string) => {
    const prev = inspectorIntent.current.collapsed;
    const collapsed = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    inspectorIntent.current = { ...inspectorIntent.current, collapsed };
    updateConfig({ inspectorCollapsed: collapsed }).catch(console.error);
  }, [updateConfig]);
  const setInspectorWidth = useCallback(
    (inspectorWidth: number) => updateConfig({ inspectorWidth }),
    [updateConfig],
  );
  const worktreeLifecycle = isBetaEnabled(config, 'betaWorktreeLifecycle');
  const handoffEnabled = isBetaEnabled(config, 'betaHandoff');
  const chainsEnabled = isBetaEnabled(config, 'betaSessionChains');
  const activityEnabled = isBetaEnabled(config, 'betaActivityTimeline');
  const templatesEnabled = isBetaEnabled(config, 'betaSessionTemplates');
  const { getOrderedSessions, reorder: reorderSession } = useSessionOrder();
  const { getOrderedSessions: getMosaicOrderedSessions, reorder: reorderMosaic } = useMosaicOrder();
  const groups = useGroups(socket);
  // Beta F13: fetches nothing and listens to nothing while the flag is off.
  const { countsBySource: chainCounts } = useChains(chainsEnabled, socket);

  type MergeFlow =
    | null
    | { phase: 'preview'; session: SessionInfo; targetBranch: string; parentRepoPath: string; preview: WorktreeMergePreviewResponse | null; availableBranches: string[] }
    | { phase: 'merging'; session: SessionInfo; targetBranch: string; parentRepoPath: string }
    | { phase: 'success'; session: SessionInfo; targetBranch: string; mergedBranch: string; parentRepoPath: string }
    | { phase: 'error'; session: SessionInfo; error: string; targetBranch?: string; parentRepoPath?: string };

  const app = useAppView();
  const windowsApi = useWindows(socket);
  const mosaicVis = useMosaicVisibility(windowsApi.myWindowId, windowsApi.isForeign);

  // Any action that would put a foreign-owned session into this window's focus
  // view (or select it there) instead jumps to the window that owns it —
  // exclusive ownership means a session only ever has one "home" tile.
  const guardForeign = useCallback((id: string, action: () => void) => {
    if (windowsApi.isForeign(id)) {
      void windowsApi.focusWindow(windowsApi.ownerOf(id)).catch(console.error);
      return;
    }
    action();
  }, [windowsApi]);
  const openSessionGuarded = useCallback(
    (id: string) => guardForeign(id, () => app.openSession(id)),
    [guardForeign, app],
  );
  const setActiveSessionGuarded = useCallback(
    (id: string) => guardForeign(id, () => app.setActiveSession(id)),
    [guardForeign, app],
  );
  const onFocusForeign = useCallback(
    (id: string) => { void windowsApi.focusWindow(windowsApi.ownerOf(id)).catch(console.error); },
    [windowsApi],
  );
  const foreignLabel = useCallback(
    (id: string) => windowsApi.labelOf(windowsApi.ownerOf(id)),
    [windowsApi],
  );
  const [filter, setFilter] = useState('');
  const [notifiedTileId, setNotifiedTileId] = useState<string | null>(null);
  const notifiedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingKill, setPendingKill] = useState<SessionInfo | null>(null);
  const [pendingKillGroup, setPendingKillGroup] = useState<SessionGroup | null>(null);
  const [pendingRestart, setPendingRestart] = useState<SessionInfo | null>(null);
  // Group filter, per window, restored on relaunch (plan 009 W2).
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => loadGroupFilter(windowsApi.myWindowId));
  useEffect(() => { persistGroupFilter(windowsApi.myWindowId, activeGroupId); }, [windowsApi.myWindowId, activeGroupId]);
  // A restored filter naming a group that was deleted meanwhile would show an
  // empty mosaic with no visible cause: drop it once the groups are known.
  useEffect(() => {
    if (!groups.loaded || activeGroupId === null || activeGroupId === OTHERS_GROUP_ID) return;
    if (!groups.groups.some((g) => g.id === activeGroupId)) setActiveGroupId(null);
  }, [groups.loaded, groups.groups, activeGroupId]);
  // "Restore layout on launch" off: a relaunch starts at the dashboard with no
  // filter. A Cmd+R reload still keeps the layout — it is not a launch.
  const [freshLaunch] = useState(consumeFreshLaunch);
  const restoreLayout = config?.restoreLayoutOnLaunch;
  const { exitFocus: resetToDashboard } = app;
  const launchResetDone = useRef(false);
  useEffect(() => {
    if (launchResetDone.current || !config) return;
    launchResetDone.current = true;
    if (freshLaunch && restoreLayout === false) {
      resetToDashboard();
      setActiveGroupId(null);
    }
  }, [config, freshLaunch, restoreLayout, resetToDashboard]);
  const [mergeFlow, setMergeFlow] = useState<MergeFlow>(null);
  // Beta F8: the worktree shell whose Finish sheet is open.
  const [finishSession, setFinishSession] = useState<SessionInfo | null>(null);
  // Beta F12: the shell whose Hand off sheet is open.
  const [handoffSession, setHandoffSession] = useState<SessionInfo | null>(null);
  // Beta F13: the shell whose Chain to sheet is open.
  const [chainSession, setChainSession] = useState<SessionInfo | null>(null);

  // Resolved keyboard shortcuts (registry defaults + user overrides from config).
  const shortcuts = useShortcuts(config?.keyboardShortcuts);

  // Mirror them into the Electron app menu. The menu items are what deliver
  // these shortcuts to a native terminal tile — its overlay is a child
  // NSWindow, so the keydown handler below never sees the keystroke — and
  // hardcoded accelerators there would ignore a rebind. Main rebuilds the menu
  // only when something actually changed.
  useEffect(() => {
    window.electronApp?.setMenuShortcuts?.(shortcuts.resolved);
  }, [shortcuts.resolved]);
  // Drops the app-menu echo of a keystroke a scoped shortcut already handled.
  const [menuEcho] = useState(createMenuEchoGuard);
  // Toggles with both a keydown case and an app-menu twin: one keystroke can
  // reach both paths, so each toggle runs through one gate (first one wins).
  const [paletteGate] = useState(() => createDedupeGate());
  const [themeGate] = useState(() => createDedupeGate());

  // F16: tell the user once per launch when stale daemons still run agents.
  const openRuntimeSettingsRef = useRef<() => void>(() => {});
  openRuntimeSettingsRef.current = () => app.openOverlay({ kind: 'settings', initialTab: 'runtime' });
  useEffect(() => { checkOrphansOnStartup(() => openRuntimeSettingsRef.current()); }, []);

  // Which terminal is "active" for Cmd+W / Cmd+F: the focused mosaic tile on the
  // dashboard, or the open session in focus view. Mosaic reports its focused tile up.
  const [mosaicFocusedId, setMosaicFocusedId] = useState<string | null>(null);
  const activeTerminalId = app.view === 'focus' ? app.activeSessionId : mosaicFocusedId;

  // Session whose in-terminal search bar is open (null = none). For an xterm
  // tile this is the whole story — it's what TerminalSearchBar renders off.
  // For a native tile it still matters (it's what tells that tile's
  // find-bar-closing effect "you're no longer the target" — see
  // TerminalShellNativeHole), but it does NOT gate opening: SwiftTerm's own
  // find bar can be dismissed from inside its own window with no callback
  // back here, so a same-session repeat Cmd+F must reach the native side
  // even though this state value doesn't change. That's why both callbacks
  // below call openNativeFindBar directly and unconditionally, rather than
  // relying on searchSessionId changing to drive an effect.
  const [searchSessionId, setSearchSessionId] = useState<string | null>(null);
  const openTerminalSearch = useCallback(() => {
    if (!activeTerminalId) return;
    setSearchSessionId(activeTerminalId);
    openNativeFindBar(activeTerminalId);
  }, [activeTerminalId]);
  const openTerminalSearchFor = useCallback((id: string) => {
    setSearchSessionId(id);
    openNativeFindBar(id);
  }, []);
  const closeTerminalSearch = useCallback(() => setSearchSessionId(null), []);

  // Whether closing a live session asks first (docs/design/feedback-surfaces.md).
  const confirmCloseShell = config?.confirmCloseShell !== false;
  const [killRemember, setKillRemember] = useState(false);

  // Read at close time, so the close handlers below don't churn on every edit.
  const groupsListRef = useRef(groups.groups);
  groupsListRef.current = groups.groups;
  const assignGroupRef = useRef(groups.assign);
  assignGroupRef.current = groups.assign;
  const myWindowIdRef = useRef(windowsApi.myWindowId);
  myWindowIdRef.current = windowsApi.myWindowId;

  // Kill a live session now. A Claude session's conversation can come back:
  // the toast offers Reopen (never "Undo" — the in-flight work is gone), which
  // re-creates it with `--resume`, back in its group slot and this window.
  const closeLiveSession = useCallback((s: SessionInfo) => {
    const slot = groupSlotOf(groupsListRef.current, s.id, new Set([FAVORITES_GROUP_ID, OTHERS_GROUP_ID]));
    if (app.view === 'focus' && app.activeSessionId === s.id) app.exitFocus();
    void closeThenOfferReopen(s, () => deleteSession(s.id), () => offerUndo({
      message: `Closed ${s.name}`,
      actionLabel: 'Reopen',
      undo: async () => {
        const created = await reopenSession(reopenRequest(s));
        if (slot) assignGroupRef.current(created.id, slot.groupId, slot.beforeId);
        const windowId = myWindowIdRef.current;
        if (windowId !== MAIN_WINDOW_ID) await api.assignWindow(created.id, windowId).catch(console.error);
      },
    }));
  }, [deleteSession, reopenSession, app]);

  // Close a session. Exited: hidden now, deleted when the Undo toast closes.
  // Live: asks first unless the confirm is off, then closes at once. Shared by
  // the card close button and Cmd+W (menu:close-session).
  const requestKill = useCallback((s: SessionInfo) => {
    const mode = closeShellMode(s, confirmCloseShell);
    if (mode === 'confirm') {
      setKillRemember(false);
      setPendingKill(s);
      return;
    }
    if (mode === 'immediate') {
      closeLiveSession(s);
      return;
    }
    deferUndoable({
      message: `Closed ${s.name}`,
      apply: () => {
        hideSession(s.id);
        if (app.view === 'focus' && app.activeSessionId === s.id) app.exitFocus();
      },
      commit: () => commitClose(s.id),
      revert: () => unhideSession(s.id),
      failureMessage: `Couldn’t close ${s.name}`,
    });
  }, [confirmCloseShell, closeLiveSession, hideSession, unhideSession, commitClose, app]);

  // Deleting a group is pure client state, so it restores exactly: no confirm,
  // just Undo. Its sessions fall back to Others meanwhile.
  const { deleteGroup, restoreGroup } = groups;
  const deleteGroupWithUndo = useCallback((id: string) => {
    const list = groupsListRef.current;
    const index = list.findIndex((g) => g.id === id);
    const group = list[index];
    if (!group || id === FAVORITES_GROUP_ID) return;
    deleteGroup(id);
    offerUndo({ message: `Deleted group ${group.name}`, undo: () => restoreGroup(group, index) });
  }, [deleteGroup, restoreGroup]);

  // Debug action: write a full diagnostics dump for the session to disk, then
  // toast the path so it can be copied and handed to an external tool.
  const handleDumpDiagnostics = useCallback(async (s: SessionInfo) => {
    try {
      const { path } = await api.dumpSessionDiagnostics(s.id);
      pushToast(`Diagnostics written to ${path}`, 'ok');
    } catch {
      pushToast('Failed to write diagnostics', 'warn');
    }
  }, []);

  // Error action host (plan 003): error surfaces anywhere dispatch "Open
  // Settings → X" / "Restart session" / "Report issue" without prop-drilling.
  const errorHostSessionsRef = useRef(sessions);
  errorHostSessionsRef.current = sessions;
  const openAppOverlay = app.openOverlay;
  useEffect(() => registerErrorActionHost({
    'open-settings': (a) => openAppOverlay({ kind: 'settings', initialTab: a.pane }),
    'restart-session': (a) => {
      const s = errorHostSessionsRef.current.find((x) => x.id === a.sessionId);
      if (s) setPendingRestart(s);
    },
    'report-issue': () => runHelpAction('report-issue'),
  }), [openAppOverlay]);

  // Resume an exited Claude session's last conversation. No confirm: the agent
  // is already gone, so nothing running is interrupted.
  const resumeSession = useCallback((s: SessionInfo) => {
    api.restartSession(s.id, { resume: true }).catch((err) => {
      toastError(err, 'Couldn’t resume the conversation');
    });
  }, []);

  // Cmd+W → close the active terminal's shell. Registered once; reads latest state via ref.
  const closeActiveShell = useCallback(() => {
    if (!activeTerminalId) return;
    const s = sessions.find((x) => x.id === activeTerminalId);
    if (s) requestKill(s);
  }, [activeTerminalId, sessions, requestKill]);
  // Cmd+N → open the create-session overlay. Owned by the Electron menu accelerator
  // so it survives terminal focus (xterm swallows the keydown before it reaches the
  // window listener). The window-keydown fallback below still handles non-terminal
  // focus; openOverlay is idempotent so a redundant double-fire is harmless.
  const openCreate = useCallback(() => app.openOverlay({ kind: 'create' }), [app]);
  const openWhatsNew = useCallback(() => app.openOverlay({ kind: 'intro', flow: 'whatsNew' }), [app]);
  // Help surfaces (plan 002). Open-only: ⌘/ can reach both the menu
  // accelerator and the keydown handler, and opening twice is harmless.
  const openShortcuts = useCallback(() => app.openOverlay({ kind: 'shortcuts' }), [app]);
  const openAbout = useCallback(() => app.openOverlay({ kind: 'about' }), [app]);
  const copyDiagnostics = useCallback(() => { void runHelpAction('copy-diagnostics'); }, []);
  const reportIssue = useCallback(() => { void runHelpAction('report-issue'); }, []);
  // Each opener also tells the discovery layer the feature was found, so no tip
  // ever teaches it (see discovery/tips.ts).
  const openInbox = useCallback(() => {
    emitDiscovery({ type: 'used', marker: 'inbox' });
    app.openOverlay({ kind: 'inbox' });
  }, [app]);
  const openBroadcast = useCallback((sessionIds: string[]) => {
    emitDiscovery({ type: 'used', marker: 'broadcast' });
    app.openOverlay({ kind: 'broadcast', sessionIds });
  }, [app]);
  // Ack-based so the sheet can show the server's refusal (unknown shell, rate
  // limit) inline; the timeout covers a dropped socket, which never acks.
  const sendBroadcast = useCallback((req: BroadcastRequest) => new Promise<BroadcastResult>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'No answer from Argus — check the connection and try again' }), 5000);
    socket.emit('session:broadcast', req, (res) => { clearTimeout(timer); resolve(res); });
  }), [socket]);
  const openSearch = useCallback(() => {
    emitDiscovery({ type: 'used', marker: 'session-search' });
    app.openOverlay({ kind: 'search' });
  }, [app]);

  // One-time What's new / Welcome (see intro/intro.ts). Opened once per launch,
  // and only when nothing else is on screen; the ref keeps a slow config write
  // from re-opening it right after the user closes it.
  const pendingIntro = introToShow(config, updateStatus?.currentVersion);
  const introAutoShownRef = useRef(false);
  useEffect(() => {
    if (!pendingIntro || introAutoShownRef.current || app.overlay) return;
    introAutoShownRef.current = true;
    app.openOverlay({ kind: 'intro', flow: pendingIntro });
  }, [pendingIntro, app]);
  // Contextual discovery (tips, notification ask). Main window only: config is
  // not pushed across windows, so a second writer would race on stale state.
  const isMainWindow = windowsApi.myWindowId === MAIN_WINDOW_ID;
  const disc = useDiscovery({ config, updateConfig, isMainWindow });
  const handleTipAction = useCallback((action: TipAction) => {
    if (action === 'inbox') openInbox();
    else if (action === 'broadcast') openBroadcast([]);
    else if (action === 'search') openSearch();
    else app.openOverlay({ kind: 'settings', initialTab: 'isolation' });
  }, [app, openInbox, openBroadcast, openSearch]);
  const handleChecklistAction = useCallback((id: ChecklistId) => {
    if (id === 'two-sessions') openCreate();
    else if (id === 'inbox') openInbox();
    else app.openOverlay({ kind: 'settings', initialTab: id === 'remote' ? 'remote' : 'notifications' });
  }, [app, openCreate, openInbox]);
  const handleIntroDone = useCallback((result: IntroResult) => {
    const version = updateStatus?.currentVersion ?? '';
    const flow = app.overlay?.kind === 'intro' ? app.overlay.flow : null;
    // The checklist write waits for the intro's own save: two PUTs in flight
    // can each load the old file and the later save drops the other's keys.
    void updateConfig(introConfigPatch(result, config?.quickActionPromptedAt, version))
      .then(() => flow && disc.patch((d) => introDiscoveryPatch(flow, d, Date.now()) ?? d))
      .catch(console.error);
    if (result.openCreate) app.openOverlay({ kind: 'create' });
    else app.closeOverlay();
  }, [app, config?.quickActionPromptedAt, updateConfig, updateStatus?.currentVersion, disc]);
  // The five actions below act on "the focused shell" — same target as the
  // window-keydown switch cases further down (open-diff/open-files/open-shell/
  // terminal-search) and useTerminal's own clear-terminal keydown case. Each is
  // extracted into its own stable callback so the Electron menu accelerator and
  // the renderer keydown path invoke the exact same function — never two copies
  // of the same body that could drift apart.
  const openDiffForFocused = useCallback(() => {
    if (!activeTerminalId) return;
    guardForeign(activeTerminalId, () => app.openMaximized({ kind: 'diff', sessionId: activeTerminalId }));
  }, [activeTerminalId, guardForeign, app]);
  const openFilesForFocused = useCallback(() => {
    if (!activeTerminalId) return;
    guardForeign(activeTerminalId, () => app.openMaximized({ kind: 'explorer', sessionId: activeTerminalId }));
  }, [activeTerminalId, guardForeign, app]);
  const openShellForFocused = useCallback(() => {
    if (!activeTerminalId) return;
    guardForeign(activeTerminalId, () => {
      app.openSession(activeTerminalId);
      app.openSidePanel({ kind: 'terminal', sessionId: activeTerminalId });
    });
  }, [activeTerminalId, guardForeign, app]);
  // Clear scrollback for the focused shell. Native tiles have no buffer-clear
  // implementation yet (Task 6) — this reaches the session:clear-buffer server
  // event via the same clearScrollback() useTerminal exports for its own
  // keydown case, but there is no local terminal.write('\x1b[3J') here for
  // instant feedback: that optimization only makes sense against a specific
  // xterm instance, which is exactly what a native tile doesn't have.
  const clearFocusedTerminalScrollback = useCallback(() => {
    if (!activeTerminalId) return;
    guardForeign(activeTerminalId, () => clearScrollback(socket, activeTerminalId));
  }, [activeTerminalId, guardForeign, socket]);
  const togglePalette = useCallback(() => {
    if (app.overlay?.kind === 'palette') app.closeOverlay();
    else app.openOverlay({ kind: 'palette' });
  }, [app]);
  // Every renderer-run app-menu item, dispatched from one `menu:command`
  // subscription (ids: electron/src/menuModel.ts). The handler map is typed
  // against the menu model, so an item without a handler fails type-check.
  // The palette runs menu rows through the same map (runMenuCommand).
  const runMenuCommand = useMenuCommandHandlers({
    openSettings: () => app.openOverlay({ kind: 'settings' }),
    togglePalette,
    toggleTheme,
    newSession: openCreate,
    closeSession: closeActiveShell,
    reviewLaunch: focusPendingLaunch,
    waitingInbox: openInbox,
    sessionSearch: openSearch,
    openDiff: openDiffForFocused,
    openFiles: openFilesForFocused,
    openShell: openShellForFocused,
    terminalSearch: openTerminalSearch,
    clearTerminal: clearFocusedTerminalScrollback,
    whatsNew: openWhatsNew,
    about: openAbout,
    showShortcuts: openShortcuts,
    reportIssue,
    copyDiagnostics,
    // A fresh action object each time, so Settings runs it even when already open.
    exportSettings: () => app.openOverlay({ kind: 'settings', action: { kind: 'export' } }),
    importSettings: () => app.openOverlay({ kind: 'settings', action: { kind: 'import' } }),
    paletteGate,
    themeGate,
    scopedEcho: menuEcho,
  });

  const orderedSessions = useMemo(() => getOrderedSessions(sessions), [sessions, getOrderedSessions]);

  /** Reposition an ungrouped session in the global order, for a drop onto a row
   *  in the sidebar's Others bucket. Others has no membership array of its own,
   *  so its order is the global one — the same list the focus-view strip uses. */
  const reorderSessionBefore = useCallback((sessionId: string, beforeId: string | null) => {
    reorderSession(insertBefore(orderedSessions.map((s) => s.id), sessionId, beforeId));
  }, [orderedSessions, reorderSession]);
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

  // Auto-exit focus when the active session disappears, or when its ownership
  // moves to another window (context-menu move, merge-all elsewhere, tear-off,
  // …) — and validate a focus view restored from sessionStorage across Cmd+R.
  // Gated on sessionsLoaded so the restored focus isn't dropped before the
  // initial list fetch resolves (the list is empty until then, which would
  // otherwise read as "not found"). The foreign check is additionally gated on
  // windowsApi.loaded: before the first GET /api/windows resolves, useWindows
  // state is empty and isForeign would read everything as foreign, which would
  // falsely eject a legitimately-focused session in a secondary window at
  // startup — leaving TWO windows mounting the same terminal is exactly the
  // bug this effect exists to prevent, so we must not race it.
  const { view: appView, activeSessionId: appActiveSessionId, exitFocus: appExitFocus } = app;
  const { loaded: windowsLoaded, isForeign: windowsIsForeign } = windowsApi;
  useEffect(() => {
    if (!sessionsLoaded) return;
    if (appView === 'focus' && appActiveSessionId) {
      const gone = !sessions.find((s) => s.id === appActiveSessionId);
      const movedAway = windowsLoaded && windowsIsForeign(appActiveSessionId);
      if (gone || movedAway) {
        appExitFocus();
      }
    }
  }, [sessionsLoaded, sessions, appView, appActiveSessionId, appExitFocus, windowsLoaded, windowsIsForeign]);

  // Notification click: highlight the tile in the mosaic (rather than jumping to focus mode).
  const highlightSession = useCallback((id: string) => {
    if (app.view === 'focus') app.exitFocus();
    if (notifiedTileTimerRef.current) clearTimeout(notifiedTileTimerRef.current);
    setNotifiedTileId(id);
    notifiedTileTimerRef.current = setTimeout(() => setNotifiedTileId(null), 1200);
  }, [app]);

  // Notifications — only from the window that owns (renders) the session.
  const { ownerOf: windowsOwnerOf, myWindowId: thisWindowId } = windowsApi;
  const ownsSession = useCallback((id: string) => windowsOwnerOf(id) === thisWindowId, [windowsOwnerOf, thisWindowId]);
  useNotifications({
    sessions,
    enabled: config?.notificationsEnabled ?? false,
    notifyOnWaiting: config?.notifyOnWaiting ?? true,
    notifyOnDone: config?.notifyOnDone ?? false,
    notifyOnPrChecks: config?.notifyOnPrChecks ?? true,
    notificationSound: config?.notificationSound ?? false,
    onFocusSession: highlightSession,
    onSwitchToSessionsTab: () => {},
    ownsSession,
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
      // xterm keeps a hidden textarea for focus and IME, so a focused terminal
      // reads as a form field. It is not one: shortcuts scoped to the focused
      // shell would be dead exactly where they are meant to work.
      const inTerminal = !!target?.closest('.xterm');
      const isTyping = !!target && !inTerminal && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      // Scoped actions (e.g. the explorer's) win over a global one on the same
      // combo — but not while an overlay covers the view that owns the scope.
      const scopes = app.overlay ? undefined : activeScopes();
      const action = shortcuts.match(e, scopes);
      const scoped = action && scopes ? scopedHandler(action) : null;
      if (scoped) {
        e.preventDefault();
        menuEcho.claim();
        scoped();
        return;
      }
      switch (action) {
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
          paletteGate.run(togglePalette);
          break;
        case 'toggle-theme':
          // Inside an editor ⌘⇧L is Monaco's Select All Occurrences.
          if (isTyping) return;
          e.preventDefault();
          themeGate.run(toggleTheme);
          break;
        case 'waiting-inbox':
          e.preventDefault();
          openInbox();
          break;
        case 'session-search':
          e.preventDefault();
          openSearch();
          break;
        case 'terminal-search':
          // Fallback when no terminal owns the keystroke (e.g. focus is on the shell
          // chrome). Open search for the active terminal; useTerminal handles the
          // focused-terminal case and swallows the default.
          e.preventDefault();
          openTerminalSearch();
          break;
        // The three navigation actions the ⋯ menu advertises. They need a shell to
        // act on, so with nothing focused the key is left alone rather than eaten.
        // Routed through guardForeign: mosaicFocusedId/activeSessionId can go stale
        // when the session it names has since moved to another window (context-menu
        // move, merge-all elsewhere) — acting on it directly would reach into a
        // session this window no longer owns.
        case 'open-diff':
          if (isTyping || !activeTerminalId) return;
          e.preventDefault();
          openDiffForFocused();
          break;
        case 'open-files':
          if (isTyping || !activeTerminalId) return;
          e.preventDefault();
          openFilesForFocused();
          break;
        case 'open-shell':
          if (isTyping || !activeTerminalId) return;
          e.preventDefault();
          openShellForFocused();
          break;
        case 'toggle-inspector':
          if (isTyping) return;
          e.preventDefault();
          toggleInspector();
          break;
        case 'show-shortcuts':
          // Inside an editor ⌘/ is Monaco's Toggle Line Comment. Anywhere else,
          // the chat composer included, it opens the sheet.
          if (target?.closest('.monaco-editor')) return;
          e.preventDefault();
          openShortcuts();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, shortcuts, openTerminalSearch, activeTerminalId, openDiffForFocused, openFilesForFocused, openShellForFocused, openInbox, openSearch, menuEcho, toggleInspector, togglePalette, paletteGate, toggleTheme, themeGate, openShortcuts]);

  const activeSession: SessionInfo | null =
    app.view === 'focus' && app.activeSessionId
      ? sessions.find((s) => s.id === app.activeSessionId) ?? null
      : null;

  // The inspector follows the open shell in focus view, the selected tile in the mosaic.
  const inspectorSession: SessionInfo | null = app.view === 'focus'
    ? activeSession
    : (mosaicFocusedId ? sessions.find((s) => s.id === mosaicFocusedId) ?? null : null);
  const inspectorColumn = inspectorVisible && inspectorSide === 'right';
  const inspectorShown = inspectorVisible && (inspectorColumn || !sidebarCollapsed);
  const openMaximized = app.openMaximized;
  const inspectorCtx = useMemo<InspectorContext>(() => ({
    usageMeter,
    prStatusEnabled: config?.showPrStatus !== false,
    onOpenDiff: (id, file) => guardForeign(id, () => openMaximized({ kind: 'diff', sessionId: id, file })),
    onOpenPrDiff: (id, pr) => guardForeign(id, () => openMaximized({ kind: 'prdiff', sessionId: id, pr })),
  }), [usageMeter, config?.showPrStatus, guardForeign, openMaximized]);
  const renderInspector = (placement: 'column' | 'sidebar') => (
    <SessionInspector
      session={inspectorSession}
      placement={placement}
      collapsed={inspectorCollapsed}
      onToggleSection={toggleInspectorSection}
      side={inspectorSide}
      onSwitchSide={switchInspectorSide}
      placeholder="Select a tile to inspect it."
      ctx={inspectorCtx}
    />
  );

  // A newly created session is unassigned by default (owned by main). From a
  // secondary window that would make it foreign in the very window that just
  // created it — claim it for this window before doing anything else with it,
  // so the post-create openSession below never expands a foreign chip.
  const claimForThisWindow = async (sessionId: string) => {
    if (windowsApi.myWindowId === MAIN_WINDOW_ID) return;
    try {
      await api.assignWindow(sessionId, windowsApi.myWindowId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreate = async (folderPath: string, name: string | undefined, agentType: string, flags: string[], worktreeBranch?: string, worktreeBase?: string, terminalEngine?: TerminalEngine, runMode?: RunMode) => {
    const created = await createSession(folderPath, name, agentType, flags, worktreeBranch, worktreeBase, terminalEngine, runMode);
    await claimForThisWindow(created.id);
    addToRecentFolders(folderPath);
    app.closeOverlay();
    // Stay in mosaic if creating from dashboard; only jump to focus when already focused.
    if (app.view === 'focus') app.openSession(created.id);
    return created;
  };

  const handleClone = async (folderPath: string, name: string | undefined, agentType: string, flags: string[], worktreeBranch?: string, terminalEngine?: TerminalEngine, runMode?: RunMode) => {
    const created = await createSession(folderPath, name, agentType, flags, worktreeBranch, undefined, terminalEngine, runMode);
    await claimForThisWindow(created.id);
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
      // FavoriteEntryMeta (a ghost favorite with no live session) carries
      // neither field, so those keep using createSession's defaults — only a
      // still-live source session's own engine/run mode carries through.
      const created = await createSession(src.folderPath, src.name, src.agentType, src.flags, undefined, undefined, session?.terminalEngine, session?.runMode);
      await claimForThisWindow(created.id);
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
      onSelectSession={openSessionGuarded}
    />
  );

  const headerToolbar = (
    <>
      <ElectronToolbar
        onOpenSettings={() => app.openOverlay({ kind: 'settings' })}
        onToggleTheme={toggleTheme}
        mosaicOrientation={app.view === 'dashboard' ? (config?.mosaicOrientation ?? 'horizontal') : undefined}
        onToggleMosaicOrientation={() => void updateConfig({
          mosaicOrientation: config?.mosaicOrientation === 'vertical' ? 'horizontal' : 'vertical',
        })}
        inspectorSide={inspectorSide}
        inspectorShown={inspectorShown}
        onToggleInspector={toggleInspector}
        inspectorHint={formatCombo(shortcuts.resolved['toggle-inspector'])}
        isDark={isDark}
        updateAvailable={!showStatusBar && updateStatus?.hasUpdate}
        updateVersion={updateStatus?.latestVersion ?? undefined}
        onOpenUpdate={() => app.openOverlay({ kind: 'update' })}
      />
      <Tooltip content="⌘N">
        <Button variant="primary" icon={Plus} size="md" onClick={() => app.openOverlay({ kind: 'create' })}>
          New
        </Button>
      </Tooltip>
    </>
  );

  // One shell action menu for the whole app: every surface that shows a shell
  // name (tile header, focus header, sidebar row, minimized chip) opens this on
  // right-click, and Rename flips that surface into an inline editor.
  // "Try … (beta)": one click switches the flag on and runs the feature on this
  // session — no detour through Settings (discovery/betaPromos.ts).
  const tryBetaPromo = (promo: BetaPromo, s: SessionInfo) => {
    void runBetaPromo(promo, s, {
      enable: (flag) => updateConfig({ [flag]: true }),
      openHandoff: setHandoffSession,
      openChain: setChainSession,
      openFinish: setFinishSession,
      openActivity: (target) => { app.openSession(target.id); app.openSidePanel({ kind: 'activity', sessionId: target.id }); },
      toast: (message) => pushToast(message, 'ok', { durationMs: 5000 }),
    }).catch(console.error);
  };
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

  const sessionMenuActions = {
    onOpen: openSessionGuarded,
    onKill: requestKill,
    onRestart: setPendingRestart,
    onResume: resumeSession,
    canResume,
    onToggleMinimize: mosaicVis.toggleMinimize,
    onDumpDiagnostics: (s: SessionInfo) => void handleDumpDiagnostics(s),
    showDiagnostics: config?.debugToolsEnabled ?? false,
    onMarkDone: (s: SessionInfo) => socket.emit('session:mark-done', s.id),
    // Same gates the mosaic tile applies, so the right-click menu never offers
    // "Apply to project" for a non-worktree shell or "Mark as done" for a busy one.
    canMarkDone: (s: SessionInfo) => s.status === 'idle',
    onMerge: handleMerge,
    canMerge: (s: SessionInfo) => !!s.worktreePath && mergeFlow?.session.id !== s.id,
    // Beta F8: no handler at all while the flag is off, so the entry never renders.
    onFinish: worktreeLifecycle ? setFinishSession : undefined,
    canFinish: (s: SessionInfo) => !!s.worktreePath && !!s.worktreeBranch,
    // Beta F12: same gating — no handler while the flag is off.
    onHandoff: handoffEnabled ? setHandoffSession : undefined,
    onChain: chainsEnabled ? setChainSession : undefined,
    onClone: (s: SessionInfo) => app.openOverlay({ kind: 'clone', folderPath: s.folderPath, agentType: s.agentType, terminalEngine: s.terminalEngine, runMode: s.runMode }),
    onFocusDiff: (id: string) => guardForeign(id, () => app.openMaximized({ kind: 'diff', sessionId: id })),
    onFocusExplorer: (id: string) => guardForeign(id, () => app.openMaximized({ kind: 'explorer', sessionId: id })),
    onFocusTerminal: (id: string) => guardForeign(id, () => { app.openSession(id); app.openSidePanel({ kind: 'terminal', sessionId: id }); }),
    onMoveToNewWindow: (s: SessionInfo) => { void windowsApi.moveToNewWindow(s.id).catch(console.error); },
    moveTargets: windowsApi.windows
      .filter((w) => w.id !== windowsApi.myWindowId)
      .map((w) => ({ id: w.id, label: w.label })),
    onMoveToWindow: (s: SessionInfo, windowId: string) => { void windowsApi.moveToWindow(s.id, windowId).catch(console.error); },
    onMergeAllHere: () => { void windowsApi.mergeAllHere().catch(console.error); },
    canMergeAllHere: windowsApi.windows.length > 1,
    // Promos only in the main window: dismissals write discovery state there.
    betaPromos: isMainWindow
      ? (s: SessionInfo) => promosFor(s, { config, liveCount, discovery: disc.discovery })
        .map((p) => ({ id: `try-${p.flag}`, label: p.label, hint: p.hint, icon: p.icon, onTry: (target: SessionInfo) => tryBetaPromo(p, target) }))
      : undefined,
    onHideBetaPromos: () => { void disc.patch((d) => ({ ...d, betaPromosHidden: [HIDE_ALL_PROMOS] })); },
  };

  // What the command palette's sources read (commands/sources). Built per
  // render, but the registry only runs while the palette is open.
  const focusedSession = activeTerminalId ? sessions.find((s) => s.id === activeTerminalId) ?? null : null;
  const commandContext: Omit<CommandContext, 'menu' | 'beginRename'> = {
    closePalette: app.closeOverlay,
    config,
    updateConfig: (patch) => { updateConfig(patch).catch(console.error); },
    shortcuts: shortcuts.resolved,
    openSettings: (pane, focusSetting) => app.openOverlay({ kind: 'settings', initialTab: pane, focusSetting }),
    toast: (message, tone = 'ok') => pushToast(message, tone),
    runMenuCommand,
    invokeMenu,
    hasPendingLaunch: hasPendingLaunch(),
    waitingCount: counts.waiting,
    isDark,
    inspectorShown,
    toggleInspector,
    scopedHandler,
    inspectorSide,
    switchInspectorSide,
    openBroadcast: () => openBroadcast([]),
    templatesEnabled,
    themeMode,
    setThemeMode,
    groups: groups.groups,
    activeGroupId,
    setActiveGroup: (id) => { setActiveGroupId(id); if (id) app.exitFocus(); },
    keepAwake: keepAwake.status,
    armKeepAwake: (ms) => { void keepAwake.arm(ms); },
    disarmKeepAwake: () => { void keepAwake.disarm(); },
    tunnelStatus: ngrok.status?.tunnelStatus ?? null,
    stopTunnel: () => { void ngrok.stopTunnel(); },
    updateVersion: updateStatus?.hasUpdate ? updateStatus.latestVersion : null,
    openUpdate: () => app.openOverlay({ kind: 'update' }),
    focusedSession,
    sessionMenuActions,
    resumable: orderedSessions.filter(canResume),
    resume: resumeSession,
  };

  return (
    <FontSettingsProvider uiFontSize={config?.uiFontSize} codeFontSize={config?.codeFontSize}>
    <DensityProvider density={config?.density}>
    <ToastProvider>
    <SessionMenuProvider
      actions={sessionMenuActions}
      shortcuts={shortcuts.resolved}
      onRename={(id, name) => void renameSession(id, name)}
    >
    <WindowChrome
      title="ARGUS"
      windowLabel={windowsApi.loaded && windowsApi.windows.length > 1 ? windowsApi.labelOf(windowsApi.myWindowId) : undefined}
      onRenameWindow={(label) => { void windowsApi.renameWindow(windowsApi.myWindowId, label).catch(console.error); }}
      leading={headerLeading}
      toolbar={headerToolbar}
    >
      <a href="#main" className="skip-link">Skip to main content</a>
      {!socketConnected && (
        <Row
          justify="center"
          gap={2}
          role="alert"
          className="eyebrow"
          style={{
            padding: 'var(--s-1-5) var(--s-4)',
            // Opaque base: the shell behind it is transparent while translucent.
            background: 'linear-gradient(var(--warn-bg), var(--warn-bg)) var(--bg-1)',
            borderBottom: '1px solid color-mix(in srgb, var(--warn) 33%, transparent)',
            color: 'var(--warn)',
            fontSize: 'var(--t-tiny)',
            flexShrink: 0,
          }}
        >
          <Icon icon={WifiOff} size="md" />
          CONNECTION LOST — RECONNECTING…
        </Row>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar
          active={sidebarActive}
          counts={counts}
          onSelect={handleSidebar}
          version={showStatusBar ? undefined : updateStatus?.currentVersion}
          ngrokConnected={ngrok.status?.tunnelStatus === 'connected'}
          inspector={inspectorVisible && inspectorSide === 'left' ? renderInspector('sidebar') : undefined}
          checklist={(
            <GettingStarted
              disc={disc}
              isMainWindow={isMainWindow}
              liveCount={liveCount}
              notificationsEnabled={config?.notificationsEnabled ?? false}
              tunnelStatus={ngrok.status?.tunnelStatus}
              onAction={handleChecklistAction}
              collapsed={sidebarCollapsed}
              onExpand={() => setSidebarExpandRequest((n) => n + 1)}
            />
          )}
          onCollapsedChange={setSidebarCollapsed}
          expandRequest={sidebarExpandRequest}
          sessionTree={
            <SessionTree
              grouped={grouped}
              activeGroupId={activeGroupId}
              isDark={isDark}
              onAssign={groups.assign}
              onReorderOthers={reorderSessionBefore}
              onToggleCollapsed={groups.toggleCollapsed}
              onFilterGroup={(id) => { setActiveGroupId(id); app.exitFocus(); }}
              onCreateGroup={(name) => groups.createGroup(name)}
              onRenameGroup={groups.renameGroup}
              onSetColor={groups.setColor}
              onSetOthersColor={groups.setOthersColor}
              onDeleteGroup={deleteGroupWithUndo}
              onKillGroup={setPendingKillGroup}
              onKillOthers={() => setPendingKillGroup({
                id: '__others__',
                name: config?.othersFolderName ?? 'Others',
                color: 'gray',
                collapsed: false,
                sessionIds: grouped.others.map((s) => s.id),
              })}
              onOpenSession={openSessionGuarded}
              onToggleFavorite={groups.toggleFavorite}
              onSpawnFromFavorite={handleSpawnFromFavorite}
              isFavorite={groups.isFavorite}
              onToggleFavoritesCollapsed={() => groups.toggleCollapsed(FAVORITES_GROUP_ID)}
              othersFolderName={config?.othersFolderName ?? 'Others'}
              onCreateSession={openCreate}
            />
          }
        />

        {/* .argus-content is opaque in every material state: it is the
            guaranteed opaque ancestor of the native terminal holes. */}
        <main id="main" className="argus-content">
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
              isForeign={windowsApi.isForeign}
              foreignLabel={foreignLabel}
              onFocusForeign={onFocusForeign}
              onOpenSession={openSessionGuarded}
              onTearOff={(id) => { void windowsApi.moveToNewWindow(id).catch(console.error); }}
              onCreate={() => app.openOverlay({ kind: 'create' })}
              onKill={requestKill}
              onRestart={setPendingRestart}
              onResume={resumeSession}
              onMarkDone={(s) => socket.emit('session:mark-done', s.id)}
              onMerge={handleMerge}
              chainCounts={chainsEnabled ? chainCounts : undefined}
              onClone={(s) => app.openOverlay({ kind: 'clone', folderPath: s.folderPath, agentType: s.agentType, terminalEngine: s.terminalEngine, runMode: s.runMode })}
              mergingSessionId={mergeFlow?.phase === 'merging' ? mergeFlow.session.id : null}
              onFocusDiff={(id) => app.openMaximized({ kind: 'diff', sessionId: id })}
              onFocusExplorer={(id) => app.openMaximized({ kind: 'explorer', sessionId: id })}
              onFocusTerminal={(id) => guardForeign(id, () => { app.openSession(id); app.openSidePanel({ kind: 'terminal', sessionId: id }); })}
              onOpenDiff={(id) => app.openMaximized({ kind: 'diff', sessionId: id })}
              shortcuts={shortcuts.resolved}
              searchSessionId={searchSessionId}
              onRequestSearch={openTerminalSearchFor}
              onCloseSearch={closeTerminalSearch}
              onActiveTerminalChange={setMosaicFocusedId}
              notifiedTileId={notifiedTileId}
              waitingStyle={config?.mosaicWaitingStyle ?? 'breathing'}
              quickAction={config?.tileQuickAction ?? DEFAULT_TILE_QUICK_ACTION}
              runningIndicator={config?.tileRunningIndicator ?? 'hairline'}
              orientation={config?.mosaicOrientation ?? 'horizontal'}
              defaultTerminalEngine={config?.defaultTerminalEngine}
              usageMeter={usageMeter}
              customAgents={config?.customAgents}
              loadError={sessionsLoadError}
              onRetryLoad={retrySessionsLoad}
              onClearFilter={() => setFilter('')}
              landingPromo={isMainWindow && templatesPromoVisible(config, disc.discovery) ? {
                onTry: () => {
                  void updateConfig({ betaSessionTemplates: true })
                    .then(() => app.openOverlay({ kind: 'settings', initialTab: 'launchers' }))
                    .catch(console.error);
                },
                onDismiss: () => {
                  void disc.patch((d) => ({ ...d, betaPromosHidden: [...d.betaPromosHidden, 'betaSessionTemplates'] }));
                },
              } : undefined}
            />
          )}

          {app.view === 'focus' && activeSession && (
            <Focus
              customAgents={config?.customAgents}
              runningIndicator={config?.tileRunningIndicator ?? 'hairline'}
              usageMeter={usageMeter}
              orientation={config?.mosaicOrientation ?? 'horizontal'}
              inspectorColumn={inspectorColumn}
              inspectorShown={inspectorShown}
              sessions={orderedSessions}
              active={activeSession}
              socket={socket}
              theme={theme}
              sidePanel={app.sidePanel}
              filter={filter}
              onSelect={setActiveSessionGuarded}
              onReorder={reorderSession}
              defaultTerminalEngine={config?.defaultTerminalEngine}
              defaultSessionView={config ? config.defaultSessionView : null}
              isForeign={windowsApi.isForeign}
              foreignLabel={foreignLabel}
              onBack={app.exitFocus}
              onToggleDiff={() => app.sidePanel?.kind === 'diff'
                ? app.dismissMaximized()
                : app.maximizeSidePanel({ kind: 'diff', sessionId: activeSession.id })}
              onToggleExplorer={() => app.sidePanel?.kind === 'explorer'
                ? app.dismissMaximized()
                : app.maximizeSidePanel({ kind: 'explorer', sessionId: activeSession.id })}
              onToggleTerminal={() => app.toggleSidePanel('terminal', activeSession.id)}
              activityEnabled={activityEnabled}
              onToggleActivity={() => app.toggleSidePanel('activity', activeSession.id)}
              onExpandDiff={(file) => app.maximizeSidePanel({ kind: 'diff', sessionId: activeSession.id, file })}
              onOpenFileInEditor={(filePath, lineNumber) =>
                app.openMaximized({ kind: 'explorer', sessionId: activeSession.id, filePath, lineNumber })}
              onRestore={app.dismissMaximized}
              onClone={() => app.openOverlay({ kind: 'clone', folderPath: activeSession.folderPath, agentType: activeSession.agentType, terminalEngine: activeSession.terminalEngine, runMode: activeSession.runMode })}
              onKill={() => requestKill(activeSession)}
              onRestart={() => setPendingRestart(activeSession)}
              onResume={canResume(activeSession) ? () => resumeSession(activeSession) : undefined}
              onDumpDiagnostics={() => void handleDumpDiagnostics(activeSession)}
              showDiagnostics={config?.debugToolsEnabled ?? false}
              shortcuts={shortcuts.resolved}
              searchOpen={searchSessionId === activeSession.id}
              onOpenSearch={() => openTerminalSearchFor(activeSession.id)}
              onCloseSearch={closeTerminalSearch}
            />
          )}
        </main>

        {inspectorColumn && (
          <InspectorColumn width={config?.inspectorWidth} onWidthChange={setInspectorWidth}>
            {renderInspector('column')}
          </InspectorColumn>
        )}
      </div>

      {showStatusBar && (
        <AppStatusBar
          socketConnected={socketConnected}
          health={backendHealth}
          waiting={counts.waiting}
          running={counts.running}
          onOpenInbox={openInbox}
          remoteOn={ngrok.status?.tunnelStatus === 'connected'}
          onOpenRemote={() => app.openOverlay({ kind: 'settings', initialTab: 'remote' })}
          keepAwakeStatus={keepAwake.status}
          onArmKeepAwake={keepAwake.arm}
          onDisarmKeepAwake={keepAwake.disarm}
          updateVersion={updateStatus?.hasUpdate ? updateStatus.latestVersion ?? undefined : undefined}
          onOpenUpdate={() => app.openOverlay({ kind: 'update' })}
          showClock={config?.showClock ?? false}
          clockShowSeconds={config?.clockShowSeconds ?? false}
          version={updateStatus?.currentVersion}
        />
      )}

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
            currentTerminalEngine={app.overlay.terminalEngine}
            currentRunMode={app.overlay.runMode}
            onClose={app.closeOverlay}
            onClone={handleClone}
            onSaveFlag={handleSaveFlag}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'palette' && (
        <Overlay onClose={app.closeOverlay} align="top" label="Find & Jump">
          <RegistryPalette
            ctx={commandContext}
            renameSurface={app.view === 'focus' ? 'focus' : 'tile'}
            sessions={sessions}
            initialScopeSessionId={app.view === 'focus' ? app.activeSessionId : null}
            onClose={app.closeOverlay}
            onJumpSession={(id) => { app.closeOverlay(); openSessionGuarded(id); }}
            onOpenInExplorer={(sessionId, filePath, lineNumber, query) => {
              app.closeOverlay();
              guardForeign(sessionId, () => app.openMaximized({ kind: 'explorer', sessionId, filePath, lineNumber, query }));
            }}
            onOpenInDiff={(sessionId) => {
              app.closeOverlay();
              guardForeign(sessionId, () => app.openMaximized({ kind: 'diff', sessionId }));
            }}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'search' && (
        <Overlay onClose={app.closeOverlay} align="top" label="Search all sessions">
          <SessionSearch
            search={api.searchSessions}
            shortcutLabel={formatCombo(shortcuts.resolved['session-search'])}
            onClose={app.closeOverlay}
            onJump={(id, hit, query) => {
              app.closeOverlay();
              openSessionGuarded(id);
              if (hit.source === 'scrollback') requestTerminalReveal(id, { query, line: hit.line });
            }}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'inbox' && (
        <Overlay onClose={app.closeOverlay} align="top" label="Waiting inbox">
          <WaitingInbox
            sessions={orderedSessions}
            shortcutLabel={formatCombo(shortcuts.resolved['waiting-inbox'])}
            onClose={app.closeOverlay}
            onJump={(id) => { app.closeOverlay(); openSessionGuarded(id); }}
            onSendKey={(id, key) => socket.emit('session:answer', { sessionId: id, key }, (res) => {
              if (!res.ok) pushToast(res.error, 'warn');
            })}
            onBroadcast={openBroadcast}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'broadcast' && (
        <BroadcastSheet
          sessions={orderedSessions}
          initialSelected={app.overlay.sessionIds}
          onSend={sendBroadcast}
          onSent={({ sent, skipped }) => {
            pushToast(`Sent to ${sent} session${sent === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (exited)` : ''}`, 'ok');
            app.closeOverlay();
          }}
          onClose={app.closeOverlay}
        />
      )}
      {app.overlay?.kind === 'update' && updateStatus && (
        <Overlay onClose={app.closeOverlay} label="Update Argus">
          <UpdateSheet
            status={updateStatus}
            progress={updateProgress}
            failure={updateFailure}
            sessions={sessions}
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
            focusSetting={app.overlay.focusSetting}
            action={app.overlay.action}
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
              onPick={(id) => { app.closeOverlay(); guardForeign(id, () => app.openMaximized({ kind: target, sessionId: id })); }}
            />
          </Overlay>
        );
      })()}

      <AlertSheet
        isOpen={!!pendingKill}
        title="Close session?"
        message={
          pendingKill?.worktreePath
            ? `This session has work that hasn't been applied to your project yet. Close anyway?`
            : `This ends the "${pendingKill?.name}" agent process. Files on disk and git history are not touched.`
        }
        confirmLabel="Close"
        confirmDestructive
        rememberChoice={{ label: "Don't ask again", checked: killRemember, onChange: setKillRemember }}
        onConfirm={() => {
          if (pendingKill) closeLiveSession(pendingKill);
          if (killRemember) void updateConfig({ confirmCloseShell: false });
          setPendingKill(null);
        }}
        onCancel={() => setPendingKill(null)}
      />

      <AlertSheet
        isOpen={!!pendingRestart}
        title="Restart session?"
        message={`This relaunches the "${pendingRestart?.name}" agent process and clears the terminal. Files on disk and git history are not touched.`}
        confirmLabel="Restart"
        confirmDestructive
        onConfirm={() => {
          if (pendingRestart) api.restartSession(pendingRestart.id).catch(console.error);
          setPendingRestart(null);
        }}
        onCancel={() => setPendingRestart(null)}
      />

      {finishSession && (
        <FinishWorktreeHost
          config={config}
          session={finishSession}
          onClose={() => setFinishSession(null)}
          onRemoved={(s) => {
            if (app.view === 'focus' && app.activeSessionId === s.id) app.exitFocus();
            pushToast(`Removed worktree ${s.worktreeBranch ?? s.name}`, 'ok');
          }}
        />
      )}

      {handoffSession && (
        <HandoffHost
          config={config}
          session={handoffSession}
          onClose={() => setHandoffSession(null)}
          onCreated={(created) => {
            adoptSession(created);
            void claimForThisWindow(created.id).then(() => app.openSession(created.id));
            pushToast(`Handed off to ${created.name}`, 'ok');
          }}
        />
      )}

      {chainSession && (
        <ChainHost
          config={config}
          session={chainSession}
          sessions={sessions}
          onClose={() => setChainSession(null)}
          onCreated={() => pushToast(`Follow-up prompt added to ${chainSession.name}`, 'ok')}
        />
      )}

      {mergeFlow && (
        <MergePreviewSheet
          mergeFlow={mergeFlow}
          onClose={() => setMergeFlow(null)}
          onMerge={(branch) => { void executeMerge(branch); }}
          onCleanUp={() => { void handleMergeDeleteWorktree(); }}
        />
      )}

      {app.overlay?.kind === 'shortcuts' && (
        <ShortcutsSheet
          resolved={shortcuts.resolved}
          conflicts={shortcuts.conflicts}
          overrides={config?.keyboardShortcuts}
          onClose={app.closeOverlay}
          onCustomize={(pane) => app.openOverlay({ kind: 'settings', initialTab: pane })}
        />
      )}
      {app.overlay?.kind === 'about' && (
        <AboutSheet
          version={updateStatus?.currentVersion}
          onClose={app.closeOverlay}
          onWhatsNew={openWhatsNew}
          onCopyDiagnostics={copyDiagnostics}
          onCheckForUpdates={() => app.openOverlay({ kind: 'update' })}
        />
      )}

      {/* One-time quick-action picker. Held back until config and the running
          version are both known, so it can never stamp itself away on boot. */}
      {app.overlay?.kind === 'intro' && updateStatus && (
        <IntroSheet
          flow={app.overlay.flow}
          version={updateStatus.currentVersion}
          config={config}
          keys={{
            inspector: formatCombo(shortcuts.resolved['toggle-inspector']),
            findInFiles: formatCombo(shortcuts.resolved['find-in-files']),
          }}
          onDone={handleIntroDone}
        />
      )}

      {pendingIntro === null && shouldPromptQuickAction(config, updateStatus?.currentVersion) && (
        <QuickActionSheet
          version={updateStatus!.currentVersion}
          onConfirm={(action, version) => {
            void updateConfig({ tileQuickAction: action, quickActionPromptedAt: version });
          }}
        />
      )}

      <AlertSheet
        isOpen={!!pendingKillGroup}
        title="Close all sessions in group?"
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

      <DiscoveryHost
        disc={disc}
        config={config}
        updateConfig={updateConfig}
        sessions={sessions}
        ownsSession={ownsSession}
        overlayOpen={!!app.overlay}
        introPending={!!pendingIntro}
        isMainWindow={isMainWindow}
        shortcuts={shortcuts.resolved}
        onTipAction={handleTipAction}
      />
    </WindowChrome>
    </SessionMenuProvider>
      {window.electronLaunch && <LaunchCardStack />}
    </ToastProvider>
    </DensityProvider>
    </FontSettingsProvider>
  );
}
