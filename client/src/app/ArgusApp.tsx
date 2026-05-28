import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../context/ThemeContext.js';
import { useSocket, useSocketStatus, reconnectSocket } from '../hooks/useSocket.js';
import { useSessions } from '../hooks/useSessions.js';
import { useSessionOrder } from '../hooks/useSessionOrder.js';
import { useGroups } from '../hooks/useGroups.js';
import { useConfig } from '../hooks/useConfig.js';
import { useNgrok } from '../hooks/useNgrok.js';
import { useUpdate } from '../hooks/useUpdate.js';
import { useNotifications } from '../hooks/useNotifications.js';
import { api, setToken } from '../services/api.js';
import { isPrimaryModifier } from '../utils/platform.js';
import type { AgentFlag, SessionInfo, AppConfig, SessionGroup } from '@argus/shared';
import { resolveGroupColor } from '../constants/groupColors.js';
import { WifiOff, Loader2, Bell, Plus } from 'lucide-react';
import { AlertSheet, Button, ToastProvider } from '../components/primitives/index.js';

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
import { RemoteOverlay } from './overlays/RemoteOverlay.js';
import { DiffOverlay } from './overlays/DiffOverlay.js';
import { ExplorerOverlay } from './overlays/ExplorerOverlay.js';
import { SessionPickerSheet } from './overlays/SessionPickerSheet.js';
import { useAppView } from './state/useAppView.js';
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
  const { getOrderedSessions } = useSessionOrder();
  const groups = useGroups();

  const app = useAppView();
  const [filter, setFilter] = useState('');
  const [pendingKill, setPendingKill] = useState<SessionInfo | null>(null);
  const [pendingKillGroup, setPendingKillGroup] = useState<SessionGroup | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const orderedSessions = useMemo(() => getOrderedSessions(sessions), [sessions, getOrderedSessions]);
  const counts = useMemo(() => deriveCounts(orderedSessions), [orderedSessions]);
  const grouped = groups.groupedSessions(orderedSessions);

  // A deleted group simply yields no active group → filter falls away on its own.
  const activeGroup = groups.groups.find((g) => g.id === activeGroupId) ?? null;
  const groupFilterIds = activeGroup ? new Set(activeGroup.sessionIds) : null;
  const groupColorOf = (sessionId: string): string | null => {
    const g = groups.groups.find((grp) => grp.sessionIds.includes(sessionId));
    if (g) return resolveGroupColor(g.color, isDark);
    return grouped.othersColor ? resolveGroupColor(grouped.othersColor, isDark) : null;
  };

  // Auto-exit focus when active session disappears
  useEffect(() => {
    if (app.view === 'focus' && app.activeSessionId) {
      if (!sessions.find((s) => s.id === app.activeSessionId)) {
        app.exitFocus();
      }
    }
  }, [sessions, app.view, app.activeSessionId]);

  // Notifications
  useNotifications({
    sessions,
    enabled: config?.notificationsEnabled ?? true,
    onFocusSession: app.openSession,
    onSwitchToSessionsTab: () => {},
  });

  // Tab title with waiting count
  useEffect(() => {
    const waiting = counts.waiting;
    document.title = waiting > 0 ? `(${waiting}) Argus` : 'Argus';
  }, [counts.waiting]);

  // Favicon flip based on idle availability
  useEffect(() => {
    const hasIdle = sessions.some((s) => s.status === 'idle');
    const href = hasIdle ? '/favicon-green.svg' : '/favicon-orange.svg';
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

  const handleCreate = async (folderPath: string, name: string | undefined, agentType: string, flags: string[]) => {
    const created = await createSession(folderPath, name, agentType, flags);
    app.closeOverlay();
    app.openSession(created.id);
  };

  const handleClone = async (folderPath: string, agentType: string, flags: string[]) => {
    const created = await createSession(folderPath, undefined, agentType, flags);
    app.closeOverlay();
    app.openSession(created.id);
  };

  const handleSaveFlag = async (agentId: string, flag: AgentFlag) => {
    if (!config) return;
    const existing = config.agentFlags[agentId] ?? [];
    const updated = existing.find((f) => f.id === flag.id)
      ? existing.map((f) => (f.id === flag.id ? flag : f))
      : [...existing, flag];
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
      case 'remote':
        app.openOverlay({ kind: 'remote' });
        return;
      case 'settings':
        app.openOverlay({ kind: 'settings' });
        return;
      case 'theme':
        toggleTheme();
        return;
      case 'diff':
        if (activeSession) app.openOverlay({ kind: 'diff', sessionId: activeSession.id });
        else if (sessions.length > 0) app.openOverlay({ kind: 'sessionPicker', target: 'diff' });
        return;
      case 'explorer':
        if (activeSession) app.openOverlay({ kind: 'explorer', sessionId: activeSession.id });
        else if (sessions.length > 0) app.openOverlay({ kind: 'sessionPicker', target: 'explorer' });
        return;
    }
  };

  const sidebarActive: SidebarKey =
    app.overlay?.kind === 'remote'
      ? 'remote'
      : app.overlay?.kind === 'settings'
        ? 'settings'
        : app.overlay?.kind === 'diff' || (app.overlay?.kind === 'sessionPicker' && app.overlay.target === 'diff')
          ? 'diff'
          : app.overlay?.kind === 'explorer' || (app.overlay?.kind === 'sessionPicker' && app.overlay.target === 'explorer')
            ? 'explorer'
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
      {app.view === 'dashboard' && (
        <button
          onClick={() => {}}
          aria-label="Notifications"
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 'var(--r-2)',
            color: 'var(--fg-2)',
            cursor: 'pointer',
            // @ts-expect-error Electron-only
            WebkitAppRegion: 'no-drag',
          }}
        >
          <Bell size={14} strokeWidth={1.6} />
          {counts.waiting > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                minWidth: 14,
                height: 14,
                padding: '0 4px',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                borderRadius: 'var(--r-pill)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              {counts.waiting}
            </span>
          )}
        </button>
      )}
      <ElectronToolbar
        onOpenSettings={() => app.openOverlay({ kind: 'settings' })}
        onToggleTheme={toggleTheme}
        onOpenRemote={() => app.openOverlay({ kind: 'remote' })}
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
          isDark={isDark}
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
              onOpenSession={app.openSession}
            />
          }
        />

        <main id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {app.view === 'dashboard' && (
            <Mosaic
              sessions={orderedSessions}
              filter={filter}
              socket={socket}
              theme={theme}
              groupFilterIds={groupFilterIds}
              groupColorOf={groupColorOf}
              onOpenSession={app.openSession}
              onCreate={() => app.openOverlay({ kind: 'create' })}
              onKill={setPendingKill}
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
              onBack={app.exitFocus}
              onToggleDiff={() => app.toggleSidePanel('diff', activeSession.id)}
              onToggleExplorer={() => app.toggleSidePanel('explorer', activeSession.id)}
              onExpandDiff={(file) => app.openOverlay({ kind: 'diff', sessionId: activeSession.id, file })}
              onExpandExplorer={(filePath) => app.openOverlay({ kind: 'explorer', sessionId: activeSession.id, filePath })}
              onClone={() => app.openOverlay({ kind: 'clone', folderPath: activeSession.folderPath, agentType: activeSession.agentType })}
              onKill={() => setPendingKill(activeSession)}
            />
          )}
        </main>
      </div>

      {/* Overlays */}
      {app.overlay?.kind === 'create' && (
        <Overlay onClose={app.closeOverlay}>
          <CreateSheet
            config={config}
            onClose={app.closeOverlay}
            onCreate={handleCreate}
            onSaveFlag={handleSaveFlag}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'clone' && (
        <Overlay onClose={app.closeOverlay}>
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
        <Overlay onClose={app.closeOverlay} align="top">
          <CommandPalette
            sessions={sessions}
            activeSessionId={app.activeSessionId}
            onClose={app.closeOverlay}
            onJumpSession={(id) => { app.closeOverlay(); app.openSession(id); }}
            onOpenInExplorer={(p) => {
              if (activeSession) {
                app.openOverlay({ kind: 'explorer', sessionId: activeSession.id });
              }
              // path open hook deferred (Explorer overlay is placeholder)
              void p;
            }}
            onOpenInDiff={() => {
              if (activeSession) app.openOverlay({ kind: 'diff', sessionId: activeSession.id });
            }}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'update' && updateStatus && (
        <Overlay onClose={app.closeOverlay}>
          <UpdateSheet status={updateStatus} onClose={app.closeOverlay} />
        </Overlay>
      )}
      {app.overlay?.kind === 'settings' && config && (
        <Overlay onClose={app.closeOverlay}>
          <SettingsOverlay
            config={config as AppConfig}
            onClose={app.closeOverlay}
            onSave={updateConfig}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'remote' && (
        <Overlay onClose={app.closeOverlay}>
          <RemoteOverlay
            status={ngrok.status}
            loading={ngrok.loading}
            error={ngrok.error}
            onStart={ngrok.startTunnel}
            onStop={ngrok.stopTunnel}
            onClose={app.closeOverlay}
          />
        </Overlay>
      )}
      {app.overlay?.kind === 'diff' && (() => {
        const ov = app.overlay as { sessionId: string; file?: string };
        const session = sessions.find((s) => s.id === ov.sessionId);
        return session ? (
          <Overlay onClose={app.closeOverlay}>
            <DiffOverlay session={session} onClose={app.closeOverlay} initialFile={ov.file} />
          </Overlay>
        ) : null;
      })()}
      {app.overlay?.kind === 'explorer' && (() => {
        const ov = app.overlay as { sessionId: string; filePath?: string };
        const session = sessions.find((s) => s.id === ov.sessionId);
        return session ? (
          <Overlay onClose={app.closeOverlay}>
            <ExplorerOverlay session={session} onClose={app.closeOverlay} initialFilePath={ov.filePath} />
          </Overlay>
        ) : null;
      })()}
      {app.overlay?.kind === 'sessionPicker' && (() => {
        const target = app.overlay.target;
        return (
          <Overlay onClose={app.closeOverlay}>
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
        title="Close session?"
        message={`This ends the “${pendingKill?.name}” agent process. Files on disk and git history are not touched.`}
        confirmLabel="Delete"
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
        isOpen={!!pendingKillGroup}
        title="Close all sessions in group?"
        message={`This ends every agent process in “${pendingKillGroup?.name}” (${pendingKillGroup?.sessionIds.length ?? 0}). Files on disk and git history are not touched.`}
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
