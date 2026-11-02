import { useState, type ReactNode } from 'react';
import { SessionRenameInput } from './SessionRenameInput.js';

interface WindowChromeProps {
  title?: string;
  subtitle?: string;
  /** This Argus window's registry label ('Main', 'Window 2', …). Rendered as a
   *  clickable chip next to the title; undefined hides the chip (e.g. before
   *  the window registry has loaded). */
  windowLabel?: string;
  /** Commit a new label for this window. Absent → chip is display-only. */
  onRenameWindow?: (label: string) => void;
  leading?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
}

/**
 * Argus OS root window. Draggable title bar (--h-titlebar) + main content area. The
 * shell paints the window material (transparent while translucent, so macOS
 * vibrancy shows through the toolbar and sidebar tints); the opaque content
 * column is the caller's `.argus-content`.
 * Electron traffic-light region is owned by macOS automatically (via no-frame
 * window settings); this chrome supplies title/subtitle and right-side toolbar
 * slot for app-level controls.
 */
export function WindowChrome({ title = 'ARGUS', subtitle, windowLabel, onRenameWindow, leading, toolbar, children }: WindowChromeProps) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="argus-shell">
      <div
        className="argus-titlebar"
        // @ts-expect-error Electron WebkitAppRegion
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="argus-titlebar-title">
          <img
            src="/spartan.png"
            alt=""
            style={{ height: 22, width: 22, verticalAlign: 'middle', marginRight: 'var(--s-2)', borderRadius: 'var(--r-2)' }}
          />
          {title}
          {subtitle && <span className="argus-titlebar-title-sub"> / {subtitle}</span>}
        </div>
        {windowLabel !== undefined && (
          <div
            // The chip sits inside the draggable title bar — no-drag so the
            // click reaches it instead of starting a window drag.
            // @ts-expect-error Electron WebkitAppRegion
            style={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center', marginLeft: 'var(--s-3)' }}
          >
            {renaming && onRenameWindow ? (
              <SessionRenameInput
                initial={windowLabel}
                onCommit={(v) => {
                  const label = v.trim();
                  if (label && label !== windowLabel) onRenameWindow(label);
                  setRenaming(false);
                }}
                onCancel={() => setRenaming(false)}
                style={{ width: 140, flex: '0 0 auto' }}
              />
            ) : (
              <button
                type="button"
                title={onRenameWindow ? 'Rename this window' : undefined}
                aria-label={`Window: ${windowLabel}${onRenameWindow ? ' — click to rename' : ''}`}
                onClick={onRenameWindow ? () => setRenaming(true) : undefined}
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border-0, transparent)',
                  borderRadius: 'var(--r-2)',
                  color: 'var(--fg-1)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-tiny)',
                  padding: 'var(--s-0-5) var(--s-2)',
                  cursor: onRenameWindow ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                }}
              >
                {windowLabel}
              </button>
            )}
          </div>
        )}
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
      <div className="argus-shell-body">
        {children}
      </div>
    </div>
  );
}
