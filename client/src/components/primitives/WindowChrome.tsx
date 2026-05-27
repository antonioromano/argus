import type { ReactNode } from 'react';

interface WindowChromeProps {
  title?: string;
  subtitle?: string;
  toolbar?: ReactNode;
  tabs?: string[];
  activeTab?: string;
  onTab?: (tab: string) => void;
  children?: ReactNode;
  /** Mount custom content inside the title bar (e.g., real macOS traffic lights from ElectronToolbar). */
  titleBarLeft?: ReactNode;
}

/**
 * Top-level Electron window chrome. Provides:
 *  - 36px title bar (draggable region for Electron — WebkitAppRegion: 'drag')
 *  - Optional traffic-light slot on the left (Electron supplies via titleBarLeft)
 *  - Optional tab strip below the title bar
 *  - Main content area
 */
export function WindowChrome({
  title = 'Argus',
  subtitle,
  toolbar,
  tabs,
  activeTab,
  onTab,
  children,
  titleBarLeft,
}: WindowChromeProps) {
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
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-3)',
          padding: '0 var(--s-3)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          // @ts-expect-error WebkitAppRegion is Electron-specific
          WebkitAppRegion: 'drag',
        }}
      >
        {titleBarLeft && (
          <div
            style={{
              // @ts-expect-error WebkitAppRegion is Electron-specific
              WebkitAppRegion: 'no-drag',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {titleBarLeft}
          </div>
        )}
        <div
          style={{
            fontSize: 'var(--t-tiny)',
            color: 'var(--fg-2)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          {title}
          {subtitle && <span style={{ color: 'var(--fg-3)' }}> / {subtitle}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {toolbar && (
          <div
            style={{
              // @ts-expect-error WebkitAppRegion is Electron-specific
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
      {tabs && (
        <div
          style={{
            height: 32,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'stretch',
            background: 'var(--bg-1)',
            borderBottom: '1px solid var(--line-2)',
            padding: '0 var(--s-2)',
            gap: 0,
          }}
        >
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => onTab?.(t)}
              style={{
                padding: '0 var(--s-3)',
                height: 32,
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${activeTab === t ? 'var(--accent)' : 'transparent'}`,
                color: activeTab === t ? 'var(--fg-0)' : 'var(--fg-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-xs)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-eye)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}
