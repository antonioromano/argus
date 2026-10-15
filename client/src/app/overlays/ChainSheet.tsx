import { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { CHAIN_PROMPT_MAX, type AppConfig, type ChainMode, type ChainTrigger, type SessionChain, type SessionInfo } from '@argus/shared';
import { Button, Field, Segmented, Sheet } from '../../components/primitives/index.js';
import { api } from '../../services/api.js';
import { isBetaEnabled } from '../../utils/betaFlags.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { chainTargets } from './chains.js';

/**
 * Beta F13 — "Chain to…": when this shell enters a state, type a prompt into
 * another one. The server enforces every rule (A ≠ B, live agent target,
 * prompt cap, repeat-loop refusal, rate caps); the sheet only pre-filters the
 * target list. Mounted only while `betaSessionChains` is on (ArgusApp gates it).
 */

const TRIGGERS: ReadonlyArray<{ value: ChainTrigger; label: string }> = [
  { value: 'idle', label: 'Idle' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];
const MODES: ReadonlyArray<{ value: ChainMode; label: string; title: string }> = [
  { value: 'once', label: 'Once', title: 'Fire one time, then disarm' },
  { value: 'repeat', label: 'Repeat', title: 'Fire on every transition (at most 10 per hour)' },
];

const selectStyle = { height: 32, width: '100%', background: 'var(--bg-3)', color: 'var(--fg-0)', border: '1px solid var(--line-3)', borderRadius: 'var(--r-2)' } as const;

interface ChainSheetProps {
  session: SessionInfo;
  sessions: SessionInfo[];
  onClose: () => void;
  onCreated?: (chain: SessionChain) => void;
}

/** What ArgusApp mounts: the sheet, but only while the beta flag is on. Flag off ⇒ nothing. */
export function ChainHost({ config, session, ...rest }: Omit<ChainSheetProps, 'session'> & { session: SessionInfo | null; config: Partial<AppConfig> | null | undefined }) {
  if (!isBetaEnabled(config, 'betaSessionChains') || !session) return null;
  return <ChainSheet session={session} {...rest} />;
}

export function ChainSheet({ session, sessions, onClose, onCreated }: ChainSheetProps) {
  const targets = useMemo(() => chainTargets(session, sessions), [session, sessions]);
  const [targetId, setTargetId] = useState(() => targets[0]?.id ?? '');
  const [trigger, setTrigger] = useState<ChainTrigger>('idle');
  const [mode, setMode] = useState<ChainMode>('once');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One typed line: newlines become spaces (the server rejects control characters).
  const line = prompt.replace(/\s*[\r\n]+\s*/g, ' ');
  const tooLong = line.length > CHAIN_PROMPT_MAX;
  const target = targets.find((t) => t.id === targetId);
  const canSubmit = !submitting && !!target && !!line.trim() && !tooLong;

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const chain = await api.createChain({ sourceId: session.id, targetId: target.id, trigger, mode, prompt: line });
      onCreated?.(chain);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the chain');
      setSubmitting(false);
    }
  };

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%' }}>
      <span data-testid="chain-summary" style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', flex: 1, minWidth: 0 }}>
        {target
          ? `When ${shellLabel(session)} goes ${trigger}, type the prompt into ${shellLabel(target)}${mode === 'once' ? ' (once)' : ' (every time)'}.`
          : 'No agent shell to chain to.'}
      </span>
      <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>Cancel</Button>
      <Button variant="primary" size="md" icon={Link2} onClick={() => { void submit(); }} disabled={!canSubmit} loading={submitting}>
        Create chain
      </Button>
    </div>
  );

  return (
    <Sheet eyebrow="CHAIN TO" title={shellLabel(session)} width={560} onClose={submitting ? undefined : onClose} footer={footer}>
      <div data-testid="chain-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-2)' }}>
          When this shell enters the state below, Argus types the prompt into the target and presses Enter.
          A busy target gets it once it settles (or never, after 10 minutes).
        </div>

        <Field label="Target" error={targets.length === 0 ? 'Start another agent shell first' : undefined}>
          <select
            data-testid="chain-target"
            aria-label="Target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={targets.length === 0}
            style={selectStyle}
          >
            {targets.map((t) => <option key={t.id} value={t.id}>{shellLabel(t)}</option>)}
          </select>
        </Field>

        <Field label="When this shell goes">
          <Segmented label="Trigger" value={trigger} options={TRIGGERS} onChange={setTrigger} compact />
        </Field>

        <Field label="Mode">
          <Segmented label="Mode" value={mode} options={MODES} onChange={setMode} compact />
        </Field>

        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ color: 'var(--fg-2)' }}>Prompt</span>
          <textarea
            data-testid="chain-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. The API is done — run the client tests against it"
            style={{
              display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, resize: 'vertical',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-0)',
              background: 'var(--bg-inset)', border: `1px solid ${tooLong ? 'var(--danger)' : 'var(--line-3)'}`, borderRadius: 'var(--r-2)', padding: 'var(--s-2)',
            }}
          />
          <span data-testid="chain-count" style={{ fontSize: 'var(--t-xs)', color: tooLong ? 'var(--danger)' : 'var(--fg-3)' }}>
            {line.length} / {CHAIN_PROMPT_MAX}
          </span>
        </label>

        {error && (
          <div role="alert" style={{ padding: 'var(--s-2) var(--s-3)', background: 'var(--danger-bg)', borderRadius: 'var(--r-2)', fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}
