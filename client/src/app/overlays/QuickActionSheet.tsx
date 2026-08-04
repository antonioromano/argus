import { useState } from 'react';
import type { TileQuickAction } from '@argus/shared';
import { Info, Minus, Maximize2, MoreHorizontal, CircleX } from 'lucide-react';
import { Sheet, Button, Kbd, StatusDot } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import {
  DEFAULT_TILE_QUICK_ACTION,
  PROMPT_QUICK_ACTIONS,
  tileActionMeta,
} from '../../constants/tileActions.js';
import { STATUS_LABELS } from '../../constants/status.js';

interface QuickActionSheetProps {
  /** Version to stamp as "already asked" — the caller supplies the running one. */
  version: string;
  /** Persist the pick (and the stamp). Skipping still stamps, keeping the default. */
  onConfirm: (action: TileQuickAction, version: string) => void;
}

/**
 * One-time picker for the tile header's configurable action. Shown on the first
 * launch after the release that introduced it, then never again (gated on
 * `quickActionPromptedAt` — see utils/quickActionPrompt).
 */
export function QuickActionSheet({ version, onConfirm }: QuickActionSheetProps) {
  const [choice, setChoice] = useState<TileQuickAction>(DEFAULT_TILE_QUICK_ACTION);
  const chosen = tileActionMeta(choice);

  return (
    <Sheet
      eyebrow={`NEW IN v${version}`}
      title="Pick your shell quick action"
      subtitle="Every shell header now keeps its name visible and always carries minimize + expand. Next to them sits one action of your choice — pick the one you reach for most. Everything else lives in the ⋯ menu."
      width={560}
      // Escape / backdrop click behave exactly like Skip: stamp the version so the
      // sheet never returns, and keep the default action.
      onClose={() => onConfirm(DEFAULT_TILE_QUICK_ACTION, version)}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontSize: 'var(--t-micro)', color: 'var(--fg-3)', maxWidth: 230, lineHeight: 1.4 }}>
            Asked once. Skipping keeps <b>{tileActionMeta(DEFAULT_TILE_QUICK_ACTION).label}</b>.
          </span>
          <Button variant="outline" onClick={() => onConfirm(DEFAULT_TILE_QUICK_ACTION, version)}>
            Skip <span style={{ marginLeft: 6 }}><Kbd>esc</Kbd></span>
          </Button>
          <Button variant="primary" onClick={() => onConfirm(choice, version)}>
            {choice === 'none' ? 'Use no pinned action' : `Use ${chosen.label}`}
          </Button>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label="Shell header quick action"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-2)' }}
      >
        {PROMPT_QUICK_ACTIONS.map((id) => {
          const meta = tileActionMeta(id);
          const Icon = meta.icon;
          const selected = choice === id;
          const isDefault = id === DEFAULT_TILE_QUICK_ACTION;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={selected}
              onClick={() => setChoice(id)}
              style={{
                all: 'unset',
                position: 'relative',
                boxSizing: 'border-box',
                cursor: 'pointer',
                display: 'flex',
                gap: 'var(--s-2)',
                alignItems: 'flex-start',
                padding: 'var(--s-3)',
                background: selected ? 'var(--accent-bg)' : 'var(--bg-1)',
                border: `1px solid ${selected ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                boxShadow: selected ? '0 0 0 1px var(--accent-edge)' : undefined,
                borderRadius: 'var(--r-2)',
              }}
            >
              {isDefault && (
                <span
                  className="eyebrow"
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    color: 'var(--accent)',
                    border: '1px solid var(--accent-edge)',
                    borderRadius: 3,
                    padding: '0 4px',
                  }}
                >
                  default
                </span>
              )}
              <span
                style={{
                  width: 26, height: 26, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-2)',
                  border: `1px solid ${selected ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                  borderRadius: 'var(--r-2)',
                  color: selected ? 'var(--accent)' : 'var(--fg-2)',
                }}
              >
                <Icon size={14} strokeWidth={1.8} />
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', color: 'var(--fg-0)', fontSize: 'var(--t-sm)', fontWeight: 'var(--fw-semibold)' }}>
                  {meta.label}
                </b>
                <span style={{ display: 'block', color: 'var(--fg-2)', fontSize: 'var(--t-micro)', lineHeight: 1.45, marginTop: 2 }}>
                  {meta.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <QuickActionPreview action={choice} />

      <div
        style={{
          display: 'flex', gap: 'var(--s-2)', alignItems: 'flex-start',
          padding: 'var(--s-2) var(--s-3)',
          borderRadius: 'var(--r-2)',
          background: 'var(--accent-bg)',
          border: '1px solid var(--accent-edge)',
          color: 'var(--fg-1)',
          fontSize: 'var(--t-xs)',
          lineHeight: 1.5,
        }}
      >
        <Info size={14} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <span>Change it any time in <b>Settings → General → Shell header</b>. <Kbd>⌘,</Kbd></span>
      </div>
    </Sheet>
  );
}

/**
 * Non-interactive replica of the tile header. Shared by this sheet and the
 * settings row so the two can never drift.
 */
/**
 * Static mock of a mosaic tile header. Mirrors the real control order in
 * views/Mosaic — pinned action ┃ minimize expand close ┃ ⋯ — so the settings
 * preview does not drift from the thing it previews. `runningIndicator` lets the
 * same widget preview that setting too, instead of a second mockup of one header.
 */
export function QuickActionPreview({
  action,
  runningIndicator = 'hairline',
}: {
  action: TileQuickAction;
  runningIndicator?: 'hairline' | 'off';
}) {
  const meta = action === 'none' ? null : tileActionMeta(action);
  const Icon = meta?.icon;
  return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', overflow: 'hidden', background: 'var(--bg-0)' }}>
      <div className="eyebrow" style={{ padding: '5px var(--s-2) 3px', color: 'var(--fg-4)' }}>preview</div>
      <div
        aria-hidden
        style={{
          position: 'relative',
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: '0 var(--s-2) 0 var(--s-3)',
          background: 'var(--bg-1)',
          borderTop: '1px solid var(--line-2)',
        }}
      >
        <AgentGlyph agent="claude" size={14} />
        <StatusDot status="running" size={7} />
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--fg-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          argus
        </span>
        <span className="argus-tile-status argus-status" data-status="running">{STATUS_LABELS.running}</span>
        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--fg-2)' }}>
          {Icon && (
            <>
              <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><Icon size={13} strokeWidth={1.7} /></span>
              <span className="argus-tile-winsep" />
            </>
          )}
          <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><Minus size={13} strokeWidth={1.7} /></span>
          <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><Maximize2 size={13} strokeWidth={1.7} /></span>
          <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><CircleX size={13} strokeWidth={1.7} /></span>
          <span className="argus-tile-winsep" />
          <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}><MoreHorizontal size={13} strokeWidth={1.7} /></span>
        </span>
        {runningIndicator === 'hairline' && <span className="argus-tile-prog"><i /></span>}
      </div>
    </div>
  );
}
