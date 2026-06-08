import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SquareTerminal, RotateCcw, Star, Trash2, CheckCircle2 } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import { AgentGlyph } from '../ui/AgentGlyph.js';

interface ActionSheetProps {
  session: SessionInfo | null;
  isFavorite: boolean;
  onOpen: (id: string) => void;
  onMarkDone?: (id: string) => void;
  onRestart: (id: string) => void;
  onToggleFavorite: (session: SessionInfo) => void;
  onKill: (session: SessionInfo) => void;
  onClose: () => void;
}

/**
 * Mobile bottom action sheet for a single session. Slides up over the list;
 * tap the scrim or any action to dismiss. Destructive Kill is separated and
 * tinted danger — it hands off to the confirm dialog rather than acting here.
 */
export function ActionSheet({
  session,
  isFavorite,
  onOpen,
  onMarkDone,
  onRestart,
  onToggleFavorite,
  onKill,
  onClose,
}: ActionSheetProps) {
  useEffect(() => {
    if (!session) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [session, onClose]);

  if (!session) return null;

  const close = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div
      onClick={onClose}
      className="glass-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-sheet)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'var(--bg-overlay)',
        animation: 'argus-fade-in var(--dur-fast) var(--ease-out)',
      }}
    >
      <div
        role="menu"
        aria-label={`Actions for ${session.name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-1)',
          borderTop: '1px solid var(--line-3)',
          borderRadius: 'var(--r-4) var(--r-4) 0 0',
          boxShadow: 'var(--shadow-sheet)',
          padding: 'var(--s-2) 0 calc(var(--s-3) + env(safe-area-inset-bottom, 0px))',
          animation: 'argus-sheet-up var(--dur-base) var(--ease-out)',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-3)', margin: '4px auto var(--s-2)' }} />
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
            padding: 'var(--s-2) var(--s-4) var(--s-3)',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-0)',
          }}
        >
          <AgentGlyph agent={session.agentType} size={20} />
          {session.name}
        </div>

        <Row icon={SquareTerminal} label="Open terminal" onClick={close(() => onOpen(session.id))} />
        {session.status === 'idle' && onMarkDone && (
          <Row icon={CheckCircle2} label="Mark as done" sub="Move this shell to done" done onClick={close(() => onMarkDone(session.id))} />
        )}
        <Row icon={RotateCcw} label="Restart shell" sub="Relaunch the agent process" onClick={close(() => onRestart(session.id))} />
        <Row
          icon={Star}
          label={isFavorite ? 'Unfavourite' : 'Favourite'}
          iconFill={isFavorite}
          onClick={close(() => onToggleFavorite(session))}
        />
        <div style={{ height: '1px', background: 'var(--line-1)', margin: 'var(--s-1) 0' }} />
        <Row icon={Trash2} label="Kill shell" danger onClick={close(() => onKill(session))} />
      </div>
    </div>
  );
}

function Row({
  icon: Icon, label, sub, danger, done, iconFill, onClick,
}: { icon: LucideIcon; label: string; sub?: string; danger?: boolean; done?: boolean; iconFill?: boolean; onClick: () => void }) {
  const color = danger ? 'var(--danger)' : done ? 'var(--status-done)' : 'var(--fg-0)';
  const iconColor = danger ? 'var(--danger)' : done ? 'var(--status-done)' : 'var(--fg-2)';
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%',
        padding: 'var(--s-3) var(--s-4)', background: 'none', border: 'none', cursor: 'pointer',
        textAlign: 'left', color, minHeight: 48,
      }}
    >
      <Icon size={18} strokeWidth={1.7} fill={iconFill ? 'currentColor' : 'none'} style={{ color: iconColor, flexShrink: 0 }} />
      <span style={{ fontSize: 'var(--t-md)', fontFamily: 'var(--font-sans)' }}>
        {label}
        {sub && <span style={{ display: 'block', fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>{sub}</span>}
      </span>
    </button>
  );
}
