import { Sun, Moon, Settings, ArrowUp, Columns2, Rows2 } from 'lucide-react';
import type { InspectorSide } from '@argus/shared';
import { PanelSideGlyph } from './PanelSideGlyph.js';
import type { MosaicOrientation } from '@argus/shared';
import { Tooltip, Icon } from '../../components/primitives/index.js';

interface ElectronToolbarProps {
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  /** Current mosaic arrangement; the button flips it. Omit to hide the button. */
  mosaicOrientation?: MosaicOrientation;
  onToggleMosaicOrientation?: () => void;
  /** Session Inspector: the button shows or hides it; the glyph marks the side it docks on. Omit the handler to hide the button. */
  inspectorSide?: InspectorSide;
  inspectorShown?: boolean;
  onToggleInspector?: () => void;
  /** Shortcut label for the tooltip, e.g. "⌘I". */
  inspectorHint?: string;
  isDark: boolean;
  /** The update notice. Passed only while the status bar is hidden — the bar
   *  carries it otherwise (plan 009: clock, keep-awake and remote moved there). */
  updateAvailable?: boolean;
  updateVersion?: string;
  onOpenUpdate?: () => void;
}

const iconBtn = (active = false): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--ctl-h-md)',
  height: 'var(--ctl-h-md)',
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
  mosaicOrientation,
  onToggleMosaicOrientation,
  inspectorSide = 'left',
  inspectorShown = false,
  onToggleInspector,
  inspectorHint,
  isDark,
  updateAvailable,
  updateVersion,
  onOpenUpdate,
}: ElectronToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
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
              gap: 'var(--s-1)',
              padding: 'var(--s-1) var(--s-2)',
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
            <Icon icon={ArrowUp} size="xs" strokeWidth={2} /> v{updateVersion}
          </button>
        )}

        {mosaicOrientation && onToggleMosaicOrientation && (
          <Tooltip content={mosaicOrientation === 'vertical' ? 'Arrange sessions side by side' : 'Stack sessions vertically'}>
            <button onClick={onToggleMosaicOrientation} style={iconBtn()}>
              {/* The icon shows the layout you switch TO, like the theme toggle. */}
              {mosaicOrientation === 'vertical'
                ? <Icon icon={Columns2} size="md" />
                : <Icon icon={Rows2} size="md" />}
            </button>
          </Tooltip>
        )}

        {onToggleInspector && (
          // A panel toggle like a sidebar button: the filled half is the side it docks on.
          <Tooltip content={`${inspectorShown ? 'Hide' : 'Show'} Session Inspector${inspectorHint ? ` · ${inspectorHint}` : ''}`}>
            <button
              onClick={onToggleInspector}
              style={iconBtn(inspectorShown)}
              aria-label={inspectorShown ? 'Hide Session Inspector' : 'Show Session Inspector'}
              aria-pressed={inspectorShown}
              data-testid="toggle-inspector"
            >
              <PanelSideGlyph side={inspectorSide} size={13} />
            </button>
          </Tooltip>
        )}

        <Tooltip content={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          <button onClick={onToggleTheme} style={iconBtn()}>
            {isDark ? <Icon icon={Sun} size="md" /> : <Icon icon={Moon} size="md" />}
          </button>
        </Tooltip>

        <Tooltip content="Settings">
          <button onClick={onOpenSettings} style={iconBtn()}>
            <Icon icon={Settings} size="md" />
          </button>
        </Tooltip>
    </div>
  );
}
