import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionInfo, SetSessionIdentityRequest } from '@argus/shared';
import { Ban } from 'lucide-react';
import { GROUP_COLORS } from '../../constants/groupColors.js';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { useTheme } from '../../context/theme-context.js';
import { Button, Icon } from '../../components/primitives/index.js';
import { CURATED_EMOJI, isSingleEmoji } from '../../utils/sessionIdentity.js';


const W = 248;

export interface IdentityPopoverProps {
  session: Pick<SessionInfo, 'id' | 'color' | 'emoji'>;
  x: number;
  y: number;
  onSave: (id: string, req: SetSessionIdentityRequest) => Promise<unknown>;
  onClose: () => void;
}

/**
 * "Color & emoji…" for one session: a swatch row (the group palette — the
 * identity draws it as an edge bar, never a dot), a curated emoji grid and a
 * one-emoji field. Every pick saves at once; the server validates again.
 */
export function IdentityPopover({ session, x, y, onSave, onClose }: IdentityPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();
  const [pos, setPos] = useState({ x, y });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState(session.color);
  const [emoji, setEmoji] = useState(session.emoji);

  useOverlaySuppression(() => ref.current?.getBoundingClientRect() ?? null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const save = (req: SetSessionIdentityRequest) => {
    setError(null);
    if (req.color !== undefined) setColor(req.color ?? undefined);
    if (req.emoji !== undefined) setEmoji(req.emoji ?? undefined);
    onSave(session.id, req).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not save the session identity');
    });
  };

  const commitDraft = () => {
    const value = draft.trim();
    if (!value) return;
    if (!isSingleEmoji(value)) {
      setError('Enter one emoji');
      return;
    }
    setDraft('');
    save({ emoji: value });
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Session color and emoji"
      className="material-float argus-identity-pop"
      style={{ left: pos.x, top: pos.y, width: W }}
    >
      <div className="eyebrow argus-identity-pop-label">Color</div>
      <div className="argus-identity-swatches" role="group" aria-label="Color">
        <button
          type="button"
          className="argus-identity-swatch"
          aria-label="No color"
          aria-pressed={!color}
          onClick={() => save({ color: null })}
        >
          <Icon icon={Ban} size={12} strokeWidth={1.8} />
        </button>
        {GROUP_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            className="argus-identity-swatch"
            aria-label={c.label}
            aria-pressed={color === c.key}
            onClick={() => save({ color: c.key })}
            style={{ background: isDark ? c.dark : c.light }}
          />
        ))}
      </div>

      <div className="eyebrow argus-identity-pop-label">Emoji</div>
      <div className="argus-identity-emoji-grid" role="group" aria-label="Emoji">
        {CURATED_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            className="argus-identity-emoji-pick"
            aria-label={e}
            aria-pressed={emoji === e}
            onClick={() => save({ emoji: e })}
          >
            {e}
          </button>
        ))}
      </div>
      <input
        className="argus-identity-input"
        aria-label="Custom emoji"
        placeholder="Or type one emoji, then Return"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
        aria-invalid={error ? true : undefined}
      />
      {error && <div role="alert" className="argus-identity-error">{error}</div>}

      <div className="argus-identity-pop-foot">
        <Button
          size="sm"
          variant="ghost"
          disabled={!color && !emoji}
          onClick={() => save({ color: null, emoji: null })}
        >
          Clear
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
