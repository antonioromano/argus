import { useLayoutEffect } from 'react';
import { ArrowUp, Globe } from 'lucide-react';
import type { BackendHealth, KeepAwakeStatus } from '@argus/shared';
import { connectionState } from './connectionState.js';
import { Icon, Tooltip } from '../../components/primitives/index.js';
import { KeepAwakeButton } from './KeepAwakeButton.js';
import { ClockDisplay } from './ClockDisplay.js';

export interface AppStatusBarProps {
  socketConnected: boolean;
  health: BackendHealth | null;
  waiting: number;
  running: number;
  /** Opens the waiting inbox. */
  onOpenInbox: () => void;
  remoteOn: boolean;
  onOpenRemote: () => void;
  keepAwakeStatus: KeepAwakeStatus | null;
  onArmKeepAwake: (durationMs: number | null) => void;
  onDisarmKeepAwake: () => void;
  /** The newer version, when an update is available. */
  updateVersion?: string;
  onOpenUpdate: () => void;
  showClock: boolean;
  clockShowSeconds: boolean;
  version?: string;
}

/**
 * The app status bar (plan 009 S2): global health in one quiet line along the
 * bottom, so the toolbar holds only actions. It sets `--statusbar-offset` on
 * the root while mounted, which lifts the toast stack and tip card above it.
 */
export function AppStatusBar(props: AppStatusBarProps) {
  const {
    socketConnected, health, waiting, running, onOpenInbox, remoteOn, onOpenRemote,
    keepAwakeStatus, onArmKeepAwake, onDisarmKeepAwake, updateVersion, onOpenUpdate,
    showClock, clockShowSeconds, version,
  } = props;

  // Layout effect: set before paint, so the toast stack never shows one frame
  // under the bar.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--statusbar-offset', 'var(--h-statusbar)');
    return () => { root.style.removeProperty('--statusbar-offset'); };
  }, []);

  const conn = connectionState(socketConnected, health);
  const sessions = [
    waiting > 0 ? `${waiting} waiting` : null,
    running > 0 ? `${running} running` : null,
  ].filter(Boolean).join(' · ') || 'No session running';

  return (
    <footer className="argus-statusbar" role="status" aria-label="Status">
      <div className="argus-statusbar-side">
        <Tooltip content={conn.hint}>
          <span className="argus-statusbar-item" data-tone={conn.tone} data-testid="statusbar-connection">
            <span className="argus-statusbar-dot" aria-hidden />
            {conn.label}
          </span>
        </Tooltip>
        <button
          type="button"
          className="argus-statusbar-item argus-statusbar-btn argus-statusbar-fill"
          onClick={onOpenInbox}
          data-tone={waiting > 0 ? 'warn' : undefined}
          aria-label={`${sessions}. Open the waiting inbox`}
        >
          <span className="argus-statusbar-text">{sessions}</span>
        </button>
      </div>

      <div className="argus-statusbar-side">
        {updateVersion && (
          <button
            type="button"
            className="argus-statusbar-item argus-statusbar-btn"
            data-tone="warn"
            onClick={onOpenUpdate}
          >
            <Icon icon={ArrowUp} size="xs" strokeWidth={2} />
            v{updateVersion} available
          </button>
        )}
        <KeepAwakeButton compact status={keepAwakeStatus} onArm={onArmKeepAwake} onDisarm={onDisarmKeepAwake} />
        <Tooltip content="Remote access settings">
          <button
            type="button"
            className="argus-statusbar-item argus-statusbar-btn"
            data-tone={remoteOn ? 'accent' : undefined}
            onClick={onOpenRemote}
            aria-label={`Remote: ${remoteOn ? 'on' : 'off'}`}
          >
            <Icon icon={Globe} size="sm" />
            <span className="argus-statusbar-label">Remote: {remoteOn ? 'on' : 'off'}</span>
          </button>
        </Tooltip>
        {showClock && (
          <span className="argus-statusbar-item" data-priority="mid">
            <ClockDisplay showSeconds={clockShowSeconds} />
          </span>
        )}
        {version && <span className="argus-statusbar-item" data-priority="low">v{version}</span>}
      </div>
    </footer>
  );
}
