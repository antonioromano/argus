import { Globe, Sun, Moon, Settings, Plus } from 'lucide-react';

interface ElectronToolbarProps {
  onNewSession: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onOpenRemote: () => void;
  isDark: boolean;
  ngrokConnected: boolean;
  updateAvailable?: boolean;
  updateVersion?: string;
  onOpenUpdate?: () => void;
}

export function ElectronToolbar({
  onNewSession,
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
        height: 'var(--toolbar-height, 52px)',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        position: 'relative',
        background: 'var(--color-bg-toolbar, var(--color-bg-deepest))',
        backdropFilter: 'blur(20px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
        borderBottom: '0.5px solid var(--color-border-ghost)',
        // Allow drag on the whole toolbar; individual buttons override this
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Traffic light spacer */}
      <div style={{ width: 80, flexShrink: 0 }} />

      {/* Centered title — pointer-events none so it doesn't block drag */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        Argus
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>
          v{__ARGUS_VERSION__}
        </span>
      </div>

      {/* Right-side controls — must all be no-drag */}
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingRight: 12,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* Update badge */}
        {updateAvailable && (
          <button
            onClick={onOpenUpdate}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 12,
              background: 'rgba(240,165,0,0.12)',
              border: '1px solid rgba(240,165,0,0.3)',
              color: 'var(--color-warning, #f0a500)',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 500,
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            {'↑'} v{updateVersion}
          </button>
        )}

        {/* Remote / Globe button */}
        <button
          onClick={onOpenRemote}
          title="Remote Access"
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            border: `1px solid ${ngrokConnected ? 'var(--color-success)' : 'var(--color-border-subtle)'}`,
            borderRadius: 7,
            background: 'none',
            color: ngrokConnected ? 'var(--color-success)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          <Globe size={15} strokeWidth={1.75} />
          {ngrokConnected && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-success)',
                border: '1.5px solid var(--color-bg-toolbar, var(--color-bg-deepest))',
              }}
            />
          )}
        </button>

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            border: 'none',
            borderRadius: 7,
            background: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          {isDark ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            border: 'none',
            borderRadius: 7,
            background: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          <Settings size={15} strokeWidth={1.75} />
        </button>

        {/* New session button */}
        <button
          onClick={onNewSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '0 14px',
            height: 30,
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            borderRadius: 7,
            background: 'var(--color-accent)',
            color: '#fff',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <Plus size={13} strokeWidth={2.5} />
          New
        </button>
      </div>
    </div>
  );
}
