import type { ReactNode } from 'react';

interface WindowChromeProps {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
}

/**
 * Argus OS root window. 36px draggable title bar + main content area.
 * Electron traffic-light region is owned by macOS automatically (via no-frame
 * window settings); this chrome supplies title/subtitle and right-side toolbar
 * slot for app-level controls.
 */
export function WindowChrome({ title = 'ARGUS', subtitle, leading, toolbar, children }: WindowChromeProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--t-base)',
      }}
    >
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-3)',
          padding: '0 var(--s-3) 0 80px',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          // @ts-expect-error Electron WebkitAppRegion
          WebkitAppRegion: 'drag',
        }}
      >
        <div
          style={{
            fontSize: 'var(--t-tiny)',
            color: 'var(--fg-2)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: 'var(--tracking-eye)',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            userSelect: 'none',
            flexShrink: 0,
          }}
        >
          {title}
          {subtitle && <span style={{ color: 'var(--fg-3)' }}> / {subtitle}</span>}
        </div>
        {leading && (
          <div
            style={{
              // @ts-expect-error Electron WebkitAppRegion
              WebkitAppRegion: 'no-drag',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
            }}
          >
            {leading}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {toolbar && (
          <div
            style={{
              // @ts-expect-error Electron WebkitAppRegion
              WebkitAppRegion: 'no-drag',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
            }}
          >
            {toolbar}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}
