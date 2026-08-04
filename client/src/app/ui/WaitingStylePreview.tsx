import { Minus, Maximize2, CircleX, MoreHorizontal, GitBranch } from 'lucide-react';
import type { AppConfig } from '@argus/shared';
import { StatusDot } from '../../components/primitives/index.js';
import { AgentGlyph } from './AgentGlyph.js';
import { STATUS_LABELS } from '../../constants/status.js';

type WaitingStyle = NonNullable<AppConfig['mosaicWaitingStyle']>;

/**
 * Miniature waiting tile for Settings → Appearance. "Breathing halo" vs "Pulse
 * bar + flag" says almost nothing as text — the difference is the motion.
 *
 * Deliberately reproduces the real class/attribute nesting
 * (`.argus-mosaic[data-waiting-style] > .argus-tile[data-status="waiting"]`)
 * rather than restyling a lookalike: the animations, the ::after overlay and the
 * filled WAITING flag then come straight from index.css, so this preview cannot
 * drift from the mosaic it is previewing.
 */
export function WaitingStylePreview({ style }: { style: WaitingStyle }) {
  return (
    <div
      className="argus-mosaic"
      data-waiting-style={style}
      aria-hidden
      style={{
        // Neutralize the mosaic's own layout — this is one tile, not a grid, and
        // `.argus-mosaic` ships `display:grid` + `flex:1` for the real view.
        display: 'block',
        flex: 'none',
        width: 240,
        height: 112,
        padding: 0,
        gap: 0,
        overflow: 'hidden',
        borderRadius: 'var(--r-2)',
      }}
    >
      <div
        className="argus-tile"
        data-status="waiting"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'relative',
            height: 28,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-2)',
            padding: '0 var(--s-2) 0 var(--s-3)',
          }}
        >
          <AgentGlyph agent="claude" size={14} />
          <StatusDot status="waiting" size={7} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-tiny)',
              color: 'var(--fg-0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            argus
          </span>
          <span className="argus-tile-status argus-status" data-status="waiting">
            {STATUS_LABELS.waiting}
          </span>
          <span className="argus-tile-actions" style={{ color: 'var(--fg-2)' }}>
            <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><GitBranch size={13} strokeWidth={1.7} /></span>
            <span className="argus-tile-winsep" />
            <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><Minus size={13} strokeWidth={1.7} /></span>
            <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><Maximize2 size={13} strokeWidth={1.7} /></span>
            <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><CircleX size={13} strokeWidth={1.7} /></span>
            <span className="argus-tile-winsep" />
            <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><MoreHorizontal size={13} strokeWidth={1.7} /></span>
          </span>
        </div>
        {/* Stand-in for the terminal fill: the breathing style's ::after sits
            above this, which is the whole reason it is drawn as an overlay. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            background: 'var(--bg-inset)',
            backgroundImage: 'linear-gradient(var(--line-1) 1px, transparent 1px)',
            backgroundSize: '100% 13px',
            borderTop: '1px solid var(--line-2)',
          }}
        />
      </div>
    </div>
  );
}
