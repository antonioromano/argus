import type { ReactNode } from 'react';

interface WindowChromeProps {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
}

/**
 * Argus OS root window. 44px draggable title bar + main content area.
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
        className="argus-titlebar"
        // @ts-expect-error Electron WebkitAppRegion
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="argus-titlebar-title">
          {title}
          {subtitle && <span className="argus-titlebar-title-sub"> / {subtitle}</span>}
        </div>
        {leading && (
          <div
            className="argus-titlebar-slot"
            // @ts-expect-error Electron WebkitAppRegion
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            {leading}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {toolbar && (
          <div
            className="argus-titlebar-slot"
            // @ts-expect-error Electron WebkitAppRegion
            style={{ WebkitAppRegion: 'no-drag' }}
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
