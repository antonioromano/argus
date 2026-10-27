import type { InspectorSide } from '@argus/shared';
import { scaledPx } from '../../components/primitives/index.js';

/**
 * A window outline with one half filled: where a side panel docks. Lucide's
 * panel icons only draw a divider, which reads poorly at toolbar size; the
 * filled half says "this side" at a glance. Sized through scaledPx so it
 * follows the interface font like every <Icon>.
 */
export function PanelSideGlyph({ side, size = 14 }: { side: InspectorSide; size?: number }) {
  const px = scaledPx(size);
  return (
    <svg viewBox="0 0 16 16" aria-hidden style={{ width: px, height: px, flexShrink: 0 }}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d={side === 'left' ? 'M4 2.5h4v11H4a2.5 2.5 0 0 1-2.5-2.5V5A2.5 2.5 0 0 1 4 2.5Z' : 'M8 2.5h4A2.5 2.5 0 0 1 14.5 5v6a2.5 2.5 0 0 1-2.5 2.5H8Z'}
        fill="currentColor"
      />
    </svg>
  );
}
