import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';
import { Button, Icon, Row, Stack, Text } from '../../components/primitives/index.js';

export const START_DELAY_MS = 1000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'launcher';

interface Props {
  view: PendingLaunchView;
  index: number;
  onApprove: (id: string, saveAs?: SaveAsLauncher) => Promise<LaunchActionResult>;
  onDiscard: (id: string) => Promise<void> | void;
}

export function PendingLaunchCard({ view, index, onApprove, onDiscard }: Props) {
  const [save, setSave] = useState(false);
  const [saveId, setSaveId] = useState(slug(view.name ?? view.label));
  const [saveLabel, setSaveLabel] = useState(view.name ?? view.label);
  const [update, setUpdate] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Start arms START_DELAY_MS after the card appears, and re-arms whenever the
  // card moves (index) or the window regains focus (epoch), so a click aimed
  // elsewhere can't approve it. `armKey` identifies the current arming period;
  // the ref mirrors the completed one so a click landing before React
  // re-renders still sees the truth.
  const [epoch, setEpoch] = useState(0);
  const [armedKey, setArmedKey] = useState('');
  const armedKeyRef = useRef('');
  const armKey = `${index}:${epoch}`;
  const armed = armedKey === armKey;
  useEffect(() => {
    const t = setTimeout(() => { armedKeyRef.current = armKey; setArmedKey(armKey); }, START_DELAY_MS);
    return () => clearTimeout(t);
  }, [armKey]);
  useEffect(() => {
    const onFocus = () => { armedKeyRef.current = ''; setEpoch((n) => n + 1); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const canUpdate = view.source === 'run' && !!view.launcherId && view.warnings.some((w) => w.kind === 'launcher-changed');
  const busy = view.state === 'starting';
  const expired = view.state === 'expired';
  const start = async () => {
    if (armedKeyRef.current !== armKey || busy || expired) return;
    const saveAs: SaveAsLauncher | undefined = canUpdate && update
      ? { id: view.launcherId!, label: view.label, overwrite: true }
      : view.source === 'new' && save && view.canSaveAsLauncher ? { id: saveId, label: saveLabel } : undefined;
    setActionError(null);
    try {
      const res = await onApprove(view.id, saveAs);
      if (!res.ok) setActionError(res.error ?? 'Launch failed');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };
  // Flags that widen what the agent may do (validateLaunch 'risky-flag') are
  // shown first, in danger styling, and marked in the argument list.
  const riskyWarnings = view.warnings.filter((w) => w.kind === 'risky-flag');
  const otherWarnings = view.warnings.filter((w) => w.kind !== 'risky-flag');
  const riskyArgs = new Set(riskyWarnings.flatMap((w) => w.flags ?? []));
  const promptLines = (view.prompt ?? '').split('\n');
  const manyLines = promptLines.length > 6;
  // One long line wraps past the 7.5em box too; offer the expander for it as well.
  const longPrompt = manyLines || (view.prompt?.length ?? 0) > 600;

  return (
    <div
      data-testid="launch-card"
      role="group"
      aria-label={`Launch request: ${view.agent} in ${view.folder}`}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === 'Escape' && !busy && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.stopPropagation(); void onDiscard(view.id); }
      }}
      style={{
        width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-3)',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)', opacity: expired ? 0.6 : 1,
      }}
    >
      <div style={{ padding: 'var(--s-3) var(--s-4)', overflowY: 'auto' }}>
        <div style={{ fontWeight: 600 }}>{view.agent} · {view.label}{view.source === 'run' && view.launcherId ? ` (launcher ${view.launcherId})` : ''}</div>
        <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', wordBreak: 'break-all' }}>{view.folder}</div>
        <Text as="div" size="small" tone="faint">
          {[view.engine && `engine ${view.engine}`, view.mode && `mode ${view.mode}`, view.name && `name ${view.name}`].filter(Boolean).join(' · ')}
        </Text>

        {riskyWarnings.map((w) => (
          <Row
            key={w.kind}
            align="start"
            gap={1.5}
            data-testid="launch-risky-warning"
            role="alert"
            style={{
              marginTop: 'var(--s-2)', padding: 'var(--s-1-5) var(--s-2)', borderRadius: 'var(--r-3)',
              border: '1px solid var(--danger, red)', color: 'var(--danger, red)', fontWeight: 600,
            }}
          >
            <Icon icon={AlertTriangle} size="lg" aria-hidden="true" style={{ flexShrink: 0, marginTop: 'var(--s-px)' }} />
            <Text size="small">{w.detail}</Text>
          </Row>
        ))}
        {otherWarnings.map((w) => (
          <Row key={w.kind} align="start" gap={1.5} data-testid="launch-warning" style={{ marginTop: 'var(--s-1-5)', color: 'var(--warn, var(--fg-0))' }}>
            <Icon icon={AlertTriangle} size="md" aria-hidden="true" style={{ flexShrink: 0, marginTop: 'var(--s-0-5)' }} />
            <Text size="small">{w.detail}</Text>
          </Row>
        ))}

        <Text as="div" size="small" tone="faint" style={{ marginTop: 'var(--s-3)' }}>Arguments (every one listed; you decide)</Text>
        {view.args.length === 0 && <Text as="div" size="small">none</Text>}
        {view.args.map((a, i) => (
          <div
            key={i}
            data-testid="launch-arg"
            data-risky={riskyArgs.has(a) || undefined}
            className="mono"
            style={{
              fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 'var(--s-0-5) 0', borderBottom: '1px solid var(--line-1)',
              ...(riskyArgs.has(a) ? { color: 'var(--danger, red)', fontWeight: 600 } : {}),
            }}
          >{a}</div>
        ))}

        {view.prompt !== undefined && (
          <>
            <Text as="div" size="small" tone="faint" style={{ marginTop: 'var(--s-3)' }}>
              Prompt <span data-testid="launch-prompt-count">({view.prompt.length} chars)</span>
            </Text>
            <div
              data-testid="launch-prompt"
              tabIndex={0}
              className="mono"
              style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: showAll ? 'none' : '7.5em', overflowY: 'auto', background: 'var(--bg-1)', padding: 'var(--s-1-5)', borderRadius: 'var(--r-2)' }}
            >
              {promptLines.map((l, i) => (<span key={i}>{l}{i < promptLines.length - 1 ? '⏎\n' : ''}</span>))}
            </div>
            {longPrompt && (
              <button type="button" onClick={() => setShowAll((v) => !v)} style={{ fontSize: 'var(--t-xs)', background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
                {showAll ? 'Show less' : manyLines ? `Show all (${promptLines.length} lines)` : `Show all (${view.prompt!.length} chars)`}
              </button>
            )}
          </>
        )}

        <details style={{ marginTop: 'var(--s-2)' }}>
          <summary style={{ fontSize: 'var(--t-xs)', cursor: 'pointer' }}>Command</summary>
          <div className="mono" style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{view.command}</div>
        </details>

        {view.state === 'error' && <Text as="div" role="alert" size="small" tone="danger" style={{ marginTop: 'var(--s-1-5)' }}>{view.error}</Text>}
        {view.state === 'pending' && view.error && <Text as="div" role="alert" size="small" tone="danger" style={{ marginTop: 'var(--s-1-5)' }}>{view.error}</Text>}
        {actionError && <Text as="div" role="alert" data-testid="launch-action-error" size="small" tone="danger" style={{ marginTop: 'var(--s-1-5)' }}>{actionError}</Text>}
      </div>

      <Stack gap={2} style={{ borderTop: '1px solid var(--line-2)', padding: 'var(--s-3) var(--s-4)' }}>
        {view.source === 'new' && !expired && (
          <Text as="div" size="small">
            <label style={{ display: 'flex', gap: 'var(--s-1-5)', alignItems: 'center' }}>
              <input data-testid="launch-save-toggle" type="checkbox" checked={save} disabled={!view.canSaveAsLauncher} onChange={(e) => setSave(e.target.checked)} />
              Save as launcher (one-click <span className="mono">run/&lt;id&gt;</span> link)
            </label>
            {!view.canSaveAsLauncher && <Text as="div" tone="faint">Not available: a launcher would create the same branch every run.</Text>}
            {save && view.canSaveAsLauncher && (
              <Row align="stretch" gap={1.5} style={{ marginTop: 'var(--s-1)' }}>
                <input data-testid="launch-save-id" className="mono" value={saveId} onChange={(e) => setSaveId(e.target.value)} aria-label="Launcher id" style={{ flex: 1 }} />
                <input data-testid="launch-save-label" value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} aria-label="Launcher label" style={{ flex: 1 }} />
              </Row>
            )}
          </Text>
        )}
        {canUpdate && !expired && (
          <label style={{ display: 'flex', gap: 'var(--s-1-5)', alignItems: 'center', fontSize: 'var(--t-xs)' }}>
            <input data-testid="launch-update-toggle" type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
            Update launcher {view.launcherId} to this command (stops asking next time)
          </label>
        )}
        <Row align="stretch" justify="end" gap={2}>
          <Button variant="ghost" disabled={busy} onClick={() => void onDiscard(view.id)}>{expired ? 'Dismiss' : 'Discard'}</Button>
          {expired ? (
            <Text size="small" tone="faint" style={{ alignSelf: 'center' }}>Expired</Text>
          ) : (
            <button
              data-testid="launch-start"
              type="button"
              aria-disabled={!armed || busy}
              onClick={start}
              style={{
                position: 'relative', overflow: 'hidden', padding: 'var(--s-1) var(--s-4)', borderRadius: 'var(--r-3)',
                border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)',
                cursor: armed && !busy ? 'pointer' : 'not-allowed', opacity: armed && !busy ? 1 : 0.6,
              }}
            >
              {busy ? 'Starting…' : view.state === 'error' ? 'Retry' : 'Start'}
              {!armed && !busy && (
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 2, background: 'var(--accent)', animation: `launch-arm ${START_DELAY_MS}ms linear forwards` }} />
              )}
            </button>
          )}
        </Row>
      </Stack>
      <style>{'@keyframes launch-arm { from { width: 0 } to { width: 100% } }'}</style>
    </div>
  );
}
