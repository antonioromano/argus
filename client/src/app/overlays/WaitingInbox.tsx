import { useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { Inbox } from 'lucide-react';
import { Checkbox, Kbd, Icon } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { formatWaiting, inboxOptions, optionForKey, waitingItems } from './inboxItems.js';

interface WaitingInboxProps {
  sessions: SessionInfo[];
  /** Display label of the inbox shortcut (e.g. ⌘⇧J). */
  shortcutLabel?: string;
  onClose: () => void;
  onJump: (id: string) => void;
  /** Answer a numbered menu: send the digit to the session. */
  onSendKey: (id: string, key: string) => void;
  /** Open broadcast input for these shells (the marked ones, else the selected one). */
  onBroadcast?: (ids: string[]) => void;
}

/**
 * Waiting inbox (F3): every shell that is waiting on the user, in one list.
 * ↑↓ pick, ↵ jumps to the shell, and a digit answers its menu directly when
 * the server could read the menu's options off the screen (promptOptions).
 * Without options a digit does nothing — the row only jumps. The list is
 * derived from live session state, so answered prompts drop out by themselves.
 */
export function WaitingInbox({ sessions, shortcutLabel, onClose, onJump, onSendKey, onBroadcast }: WaitingInboxProps) {
  const items = useMemo(() => waitingItems(sessions), [sessions]);
  // Selection follows the session, not the row index, so a row leaving the
  // list (answered elsewhere) doesn't move the highlight onto a different shell.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((s) => s.id === selectedId) ?? items[0] ?? null;
  const selectedIndex = selected ? items.indexOf(selected) : -1;

  // Shells marked (Space) for a broadcast; only those still waiting count.
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const markedIds = items.filter((s) => marked.has(s.id)).map((s) => s.id);
  const toggleMark = (id: string) => setMarked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const [now, setNow] = useState(() => Date.now());
  const ticking = items.length > 0;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (!selected) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = items[Math.min(items.length - 1, Math.max(0, selectedIndex + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onJump(selected.id);
      } else if (onBroadcast && e.key === ' ') {
        e.preventDefault();
        toggleMark(selected.id);
      } else if (onBroadcast && (e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onBroadcast(markedIds.length ? markedIds : [selected.id]);
      } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const key = optionForKey(selected, e.key);
        if (!key) return;
        e.preventDefault();
        onSendKey(selected.id, key);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [items, selected, selectedIndex, markedIds, onClose, onJump, onSendKey, onBroadcast]);

  useEffect(() => {
    if (selected) document.getElementById(`inbox-row-${selected.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-pop)',
        width: 'min(92vw, 720px)',
        maxHeight: '66vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-2)' }}>
        <Icon icon={Inbox} size={14} strokeWidth={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-md)', color: 'var(--fg-0)' }}>Waiting on you</span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-micro)',
            color: items.length ? 'var(--accent)' : 'var(--fg-3)',
            background: items.length ? 'var(--accent-bg)' : 'var(--bg-3)',
            borderRadius: 10,
            padding: '0 6px',
          }}
        >
          {items.length}
        </span>
        <span style={{ flex: 1 }} />
        {shortcutLabel && <Kbd>{shortcutLabel}</Kbd>}
      </div>

      <div role="listbox" aria-label="Waiting shells" className="argus-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {items.length === 0 && (
          <div
            className="empty-hint"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--s-2)',
              padding: 'var(--s-6)',
              color: 'var(--fg-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
            }}
          >
            <Icon icon={Inbox} size={22} strokeWidth={1.2} />
            <span>Nothing is waiting on you.</span>
          </div>
        )}
        {items.map((s) => {
          const isSelected = selected?.id === s.id;
          return (
            <div
              key={s.id}
              id={`inbox-row-${s.id}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => onJump(s.id)}
              onMouseEnter={() => setSelectedId(s.id)}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px var(--s-4)',
                cursor: 'pointer',
                background: isSelected ? 'var(--bg-3)' : 'transparent',
                borderLeft: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {onBroadcast && (
                <div style={{ paddingTop: 1, flexShrink: 0 }}>
                  <Checkbox checked={marked.has(s.id)} onChange={() => toggleMark(s.id)} size={14} />
                </div>
              )}
              <div style={{ paddingTop: 1, flexShrink: 0 }}>
                <AgentGlyph agent={s.agentType} size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--t-sm)',
                      fontWeight: 500,
                      color: isSelected ? 'var(--accent)' : 'var(--fg-0)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                    {s.agentType} · {s.folderPath.split('/').slice(-2).join('/')}
                  </span>
                  <span style={{ flex: 1 }} />
                  {s.waitingSince !== undefined && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--warn)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {formatWaiting(now - s.waitingSince)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--t-xs)', lineHeight: 1.45, color: s.lastPrompt ? 'var(--fg-1)' : 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.lastPrompt ?? 'Waiting for input'}
                </div>
                {inboxOptions(s).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {inboxOptions(s).map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        className="argus-inbox-option"
                        title={o.label}
                        onClick={(e) => { e.stopPropagation(); onSendKey(s.id, o.key); }}
                      >
                        <Kbd>{o.key}</Kbd>
                        <span className="argus-inbox-option-label">{o.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-4)', padding: 'var(--s-2) var(--s-4)', background: 'var(--bg-1)', borderTop: '1px solid var(--line-2)', flexShrink: 0 }}>
        {[
          { key: '↑↓', label: 'NAVIGATE' },
          { key: '↵', label: 'JUMP' },
          ...(selected && inboxOptions(selected).length ? [{ key: `1–${inboxOptions(selected).at(-1)!.key}`, label: 'ANSWER' }] : []),
          ...(onBroadcast && items.length ? [
            { key: 'Space', label: 'MARK' },
            { key: 'B', label: markedIds.length ? `BROADCAST (${markedIds.length})` : 'BROADCAST' },
          ] : []),
          { key: 'Esc', label: 'CLOSE' },
        ].map(({ key, label }) => (
          <span key={label} className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Kbd>{key}</Kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
