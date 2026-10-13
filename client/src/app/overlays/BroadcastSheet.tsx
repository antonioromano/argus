import { useMemo, useState } from 'react';
import { BROADCAST_MAX_TARGETS, type BroadcastRequest, type BroadcastResult, type SessionInfo } from '@argus/shared';
import { Send } from 'lucide-react';
import { Button, Checkbox, Sheet, StatusPill, TextInput, Toggle } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { broadcastTargets, broadcastTextError } from './broadcastInput.js';

interface BroadcastSheetProps {
  sessions: SessionInfo[];
  /** Sessions ticked when the sheet opens (e.g. marked in the waiting inbox). */
  initialSelected: readonly string[];
  onSend: (req: BroadcastRequest) => Promise<BroadcastResult>;
  /** Called after a successful send with the result, then the sheet closes. */
  onSent: (result: Extract<BroadcastResult, { ok: true }>) => void;
  onClose: () => void;
}

/**
 * Broadcast input (F4): type one line into several shells at once. Two steps
 * — compose (pick shells, write the text), then a confirmation that names
 * every target — so a stray Enter can never fan a command out unseen.
 */
export function BroadcastSheet({ sessions, initialSelected, onSend, onSent, onClose }: BroadcastSheetProps) {
  const targets = useMemo(() => broadcastTargets(sessions), [sessions]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [text, setText] = useState('');
  const [enter, setEnter] = useState(true);
  const [step, setStep] = useState<'compose' | 'confirm'>('compose');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only live, still-present sessions count — one that exited while the sheet
  // was open drops out of the send without the user un-ticking it.
  const chosen = targets.filter((s) => selected.has(s.id));
  const textError = broadcastTextError(text, enter);
  const tooMany = chosen.length > BROADCAST_MAX_TARGETS;
  const canReview = chosen.length > 0 && !textError && !tooMany;

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allOn = targets.length > 0 && chosen.length === targets.length;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await onSend({ sessionIds: chosen.map((s) => s.id), text, enter });
      if (res.ok) onSent(res);
      else setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setSending(false);
    }
  };

  const footer = step === 'compose' ? (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      <Button variant="primary" size="sm" icon={Send} disabled={!canReview} onClick={() => setStep('confirm')}>
        Review ({chosen.length})
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" disabled={sending} onClick={() => { setStep('compose'); setError(null); }}>Back</Button>
      <Button variant="primary" size="sm" icon={Send} disabled={sending || chosen.length === 0} onClick={() => { void send(); }}>
        {sending ? 'Sending…' : `Send to ${chosen.length} shell${chosen.length === 1 ? '' : 's'}`}
      </Button>
    </>
  );

  return (
    <Sheet
      eyebrow="Broadcast input"
      title={step === 'compose' ? 'Send to several shells' : 'Confirm broadcast'}
      subtitle={step === 'compose'
        ? 'The same line is typed into every shell you tick.'
        : 'This is typed into each shell below, as if you had typed it.'}
      width={560}
      onClose={onClose}
      footer={footer}
    >
      {step === 'compose' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
            <TextInput
              mono
              autoFocus
              value={text}
              onChange={(v) => { setText(v); setError(null); }}
              placeholder="/compact · rebase on main · y"
              error={!!text && !!textError}
              onKeyDown={(e) => { if (e.key === 'Enter' && canReview) { e.preventDefault(); setStep('confirm'); } }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', fontSize: 'var(--t-xs)', color: 'var(--fg-2)' }}>
              <Toggle size="sm" checked={enter} onChange={setEnter} />
              <span>Press Enter after the text</span>
              <span style={{ flex: 1 }} />
              {text && textError && <span style={{ color: 'var(--danger)' }}>{textError}</span>}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--s-2)' }}>
              <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>SHELLS · {chosen.length} OF {targets.length}</span>
              <span style={{ flex: 1 }} />
              {targets.length > 0 && (
                <button
                  type="button"
                  className="argus-link-btn"
                  onClick={() => setSelected(allOn ? new Set() : new Set(targets.map((s) => s.id)))}
                >
                  {allOn ? 'None' : 'All'}
                </button>
              )}
            </div>
            {targets.length === 0 && (
              <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)', padding: 'var(--s-3) 0' }}>No running shells.</div>
            )}
            <div role="group" aria-label="Target shells" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {targets.map((s) => (
                <div
                  key={s.id}
                  className="argus-broadcast-row"
                  data-selected={selected.has(s.id) || undefined}
                  onClick={() => toggle(s.id)}
                >
                  <Checkbox checked={selected.has(s.id)} onChange={() => toggle(s.id)} size={14} />
                  <AgentGlyph agent={s.agentType} size={14} />
                  <span className="argus-broadcast-name">{s.name}</span>
                  <span className="argus-broadcast-path">{s.folderPath.split('/').slice(-2).join('/')}</span>
                  <span style={{ flex: 1 }} />
                  <StatusPill status={s.status} size="sm" />
                </div>
              ))}
            </div>
            {tooMany && (
              <div style={{ marginTop: 'var(--s-2)', fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>
                At most {BROADCAST_MAX_TARGETS} shells per broadcast.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <div
            data-testid="broadcast-preview"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              color: 'var(--fg-0)',
              background: 'var(--bg-1)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-2)',
              padding: 'var(--s-3)',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {text || <span style={{ color: 'var(--fg-3)' }}>(no text)</span>}
            {enter && <span style={{ color: 'var(--accent)' }}> ⏎ Enter</span>}
          </div>
          <div>
            <div className="eyebrow" style={{ color: 'var(--fg-3)', marginBottom: 'var(--s-2)' }}>
              TO {chosen.length} SHELL{chosen.length === 1 ? '' : 'S'}
            </div>
            <ul data-testid="broadcast-targets" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {chosen.map((s) => (
                <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', fontSize: 'var(--t-sm)' }}>
                  <AgentGlyph agent={s.agentType} size={14} />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-0)' }}>{s.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>{s.folderPath}</span>
                </li>
              ))}
            </ul>
          </div>
          {error && <div role="alert" style={{ fontSize: 'var(--t-sm)', color: 'var(--danger)' }}>{error}</div>}
        </div>
      )}
    </Sheet>
  );
}
