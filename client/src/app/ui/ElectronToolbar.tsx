import { Globe, Sun, Moon, Settings, ArrowUp, Columns2, Rows2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { KeepAwakeStatus, MosaicOrientation } from '@argus/shared';
import { Tooltip } from '../../components/primitives/index.js';
import { KeepAwakeButton } from './KeepAwakeButton.js';

function formatTime(date: Date, showSeconds: boolean): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  if (!showSeconds) return `${h}:${m}`;
  return `${h}:${m}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function ClockDisplay({ showSeconds = false }: { showSeconds?: boolean }) {
  // Store the raw Date in state and format during render: a `showSeconds` change
  // reformats immediately via the prop without a synchronous setState in the effect.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = formatTime(now, showSeconds);
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--t-tiny)',
      letterSpacing: 'var(--tracking-eye)',
      color: 'var(--fg-3)',
      padding: '3px 6px',
      // @ts-expect-error Electron-only
      WebkitAppRegion: 'no-drag',
    }}>
      {time}
    </span>
  );
}

interface ElectronToolbarProps {
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onOpenRemote: () => void;
  /** Current mosaic arrangement; the button flips it. Omit to hide the button. */
  mosaicOrientation?: MosaicOrientation;
  onToggleMosaicOrientation?: () => void;
  isDark: boolean;
  ngrokConnected: boolean;
  updateAvailable?: boolean;
  updateVersion?: string;
  onOpenUpdate?: () => void;
  showClock?: boolean;
  clockShowSeconds?: boolean;
  keepAwakeStatus: KeepAwakeStatus | null;
  onArmKeepAwake: (durationMs: number | null) => void;
  onDisarmKeepAwake: () => void;
}

const iconBtn = (active = false): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: `1px solid ${active ? 'var(--accent-edge)' : 'transparent'}`,
  borderRadius: 'var(--r-2)',
  background: active ? 'var(--accent-bg)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--fg-2)',
  cursor: 'pointer',
  transition: 'background var(--dur-fast) var(--ease-std), color var(--dur-fast)',
  // @ts-expect-error Electron-only
  WebkitAppRegion: 'no-drag',
});

export function ElectronToolbar({
  onOpenSettings,
  onToggleTheme,
  onOpenRemote,
  mosaicOrientation,
  onToggleMosaicOrientation,
  isDark,
  ngrokConnected,
  updateAvailable,
  updateVersion,
  onOpenUpdate,
  showClock,
  clockShowSeconds,
  keepAwakeStatus,
  onArmKeepAwake,
  onDisarmKeepAwake,
}: ElectronToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        // @ts-expect-error Electron-only
        WebkitAppRegion: 'no-drag',
      }}
    >
        {showClock && <ClockDisplay showSeconds={clockShowSeconds} />}
        {updateAvailable && (
          <button
            onClick={onOpenUpdate}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 'var(--r-2)',
              background: 'var(--warn-bg)',
              border: '1px solid color-mix(in srgb, var(--warn) 33%, transparent)',
              color: 'var(--warn)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-tiny)',
              letterSpacing: 'var(--tracking-eye)',
              cursor: 'pointer',
              fontWeight: 500,
              // @ts-expect-error Electron-only
              WebkitAppRegion: 'no-drag',
            }}
          >
            <ArrowUp size={10} strokeWidth={2} /> v{updateVersion}
          </button>
        )}

        <KeepAwakeButton
          status={keepAwakeStatus}
          onArm={onArmKeepAwake}
          onDisarm={onDisarmKeepAwake}
        />

        <Tooltip content="Remote Access">
          <button
            onClick={onOpenRemote}
            style={{
              ...iconBtn(ngrokConnected),
              position: 'relative',
              border: `1px solid ${ngrokConnected ? 'var(--accent-edge)' : 'transparent'}`,
              color: ngrokConnected ? 'var(--accent)' : 'var(--fg-2)',
            }}
          >
            <Globe size={13} strokeWidth={1.6} />
            {ngrokConnected && (
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  boxShadow: '0 0 6px var(--accent)',
                  border: '1.5px solid var(--bg-1)',
                }}
              />
            )}
          </button>
        </Tooltip>

        {mosaicOrientation && onToggleMosaicOrientation && (
          <Tooltip content={mosaicOrientation === 'vertical' ? 'Arrange shells side by side' : 'Stack shells vertically'}>
            <button onClick={onToggleMosaicOrientation} style={iconBtn()}>
              {/* Icon shows the layout you switch TO, like the theme toggle. */}
              {mosaicOrientation === 'vertical'
                ? <Columns2 size={13} strokeWidth={1.6} />
                : <Rows2 size={13} strokeWidth={1.6} />}
            </button>
          </Tooltip>
        )}

        <Tooltip content={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          <button onClick={onToggleTheme} style={iconBtn()}>
            {isDark ? <Sun size={13} strokeWidth={1.6} /> : <Moon size={13} strokeWidth={1.6} />}
          </button>
        </Tooltip>

        <Tooltip content="Settings">
          <button onClick={onOpenSettings} style={iconBtn()}>
            <Settings size={13} strokeWidth={1.6} />
          </button>
        </Tooltip>
    </div>
  );
}
