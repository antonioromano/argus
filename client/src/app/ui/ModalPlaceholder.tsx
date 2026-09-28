import type { SessionStatus } from '@argus/shared';
import { StatusPill } from '../../components/primitives/index.js';

/**
 * Covers a tile's terminal while a full-screen sheet or modal is open. An
 * Advanced (native-view) terminal has to be hidden then — it is a macOS window
 * stacked above the page and would show through the sheet — so without this
 * that tile goes blank while web tiles stay visible. Covering every tile the
 * same way keeps the grid consistent. The terminal stays mounted underneath;
 * nothing reloads when the sheet closes. The parent must be `position: relative`.
 */
export function ModalPlaceholder({ status }: { status: SessionStatus }) {
  return (
    <div
      data-testid="modal-placeholder"
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'repeating-linear-gradient(135deg, var(--bg-2) 0 10px, color-mix(in srgb, var(--bg-2) 70%, var(--bg-3)) 10px 20px)',
      }}
    >
      <StatusPill status={status} />
    </div>
  );
}
