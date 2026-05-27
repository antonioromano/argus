import { Globe, Sun, Moon, Settings, ArrowUp } from 'lucide-react';

interface ElectronToolbarProps {
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onOpenRemote: () => void;
  isDark: boolean;
  ngrokConnected: boolean;
  updateAvailable?: boolean;
  updateVersion?: string;
  onOpenUpdate?: () => void;
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
  isDark,
  ngrokConnected,
  updateAvailable,
  updateVersion,
  onOpenUpdate,
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

        <button
          onClick={onOpenRemote}
          title="Remote Access"
          style={{
            ...iconBtn(ngrokConnected),
            position: 'relative',
            border: `1px solid ${ngrokConnected ? 'var(--accent-edge)' : 'var(--line-2)'}`,
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

        <button
          onClick={onToggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={iconBtn()}
        >
          {isDark ? <Sun size={13} strokeWidth={1.6} /> : <Moon size={13} strokeWidth={1.6} />}
        </button>

        <button onClick={onOpenSettings} title="Settings" style={iconBtn()}>
          <Settings size={13} strokeWidth={1.6} />
        </button>
    </div>
  );
}
