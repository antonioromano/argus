import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';
import { Button } from '../../components/primitives/index.js';

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
    const onFocus = () => setEpoch((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const canUpdate = view.source === 'run' && !!view.launcherId && view.warnings.some((w) => w.kind === 'launcher-changed');
  const busy = view.state === 'starting';
  const expired = view.state === 'expired';
  const start = () => {
    if (armedKeyRef.current !== armKey || busy || expired) return;
    const saveAs: SaveAsLauncher | undefined = canUpdate && update
      ? { id: view.launcherId!, label: view.label, overwrite: true }
      : view.source === 'new' && save && view.canSaveAsLauncher ? { id: saveId, label: saveLabel } : undefined;
    void onApprove(view.id, saveAs);
  };
  const promptLines = (view.prompt ?? '').split('\n');
  const longPrompt = promptLines.length > 6;

  return (
    <div
      data-testid="launch-card"
      role="group"
      aria-label={`Launch request: ${view.agent} in ${view.folder}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); void onDiscard(view.id); } }}
      style={{
        width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,.35)', opacity: expired ? 0.6 : 1,
      }}
    >
      <div style={{ padding: 'var(--s-3) var(--s-4)', overflowY: 'auto' }}>
        <div style={{ fontWeight: 600 }}>{view.agent} · {view.label}{view.source === 'run' && view.launcherId ? ` (launcher ${view.launcherId})` : ''}</div>
        <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', wordBreak: 'break-all' }}>{view.folder}</div>
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>
          {[view.engine && `engine ${view.engine}`, view.mode && `mode ${view.mode}`, view.name && `name ${view.name}`].filter(Boolean).join(' · ')}
        </div>

        {view.warnings.map((w) => (
          <div key={w.kind} data-testid="launch-warning" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6, color: 'var(--warn, var(--fg-0))' }}>
            <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 'var(--t-xs)' }}>{w.detail}</span>
          </div>
        ))}

        <div style={{ marginTop: 'var(--s-3)', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>Arguments (every one listed; you decide)</div>
        {view.args.length === 0 && <div style={{ fontSize: 'var(--t-xs)' }}>none</div>}
        {view.args.map((a, i) => (
          <div key={i} data-testid="launch-arg" className="mono" style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '2px 0', borderBottom: '1px solid var(--line-1)' }}>{a}</div>
        ))}

        {view.prompt !== undefined && (
          <>
            <div style={{ marginTop: 'var(--s-3)', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>
              Prompt <span data-testid="launch-prompt-count">({view.prompt.length} chars)</span>
            </div>
            <div
              data-testid="launch-prompt"
              tabIndex={0}
              className="mono"
              style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: showAll ? 'none' : '7.5em', overflowY: 'auto', background: 'var(--bg-1)', padding: 6, borderRadius: 4 }}
            >
              {promptLines.map((l, i) => (<span key={i}>{l}{i < promptLines.length - 1 ? '⏎\n' : ''}</span>))}
            </div>
            {longPrompt && (
              <button type="button" onClick={() => setShowAll((v) => !v)} style={{ fontSize: 'var(--t-xs)', background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
                {showAll ? 'Show less' : `Show all (${promptLines.length} lines)`}
              </button>
            )}
          </>
        )}

        <details style={{ marginTop: 'var(--s-2)' }}>
          <summary style={{ fontSize: 'var(--t-xs)', cursor: 'pointer' }}>Command</summary>
          <div className="mono" style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{view.command}</div>
        </details>

        {view.state === 'error' && <div role="alert" style={{ marginTop: 6, color: 'var(--danger, red)', fontSize: 'var(--t-xs)' }}>{view.error}</div>}
        {view.state === 'pending' && view.error && <div role="alert" style={{ marginTop: 6, color: 'var(--danger, red)', fontSize: 'var(--t-xs)' }}>{view.error}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--line-2)', padding: 'var(--s-3) var(--s-4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {view.source === 'new' && !expired && (
          <div style={{ fontSize: 'var(--t-xs)' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input data-testid="launch-save-toggle" type="checkbox" checked={save} disabled={!view.canSaveAsLauncher} onChange={(e) => setSave(e.target.checked)} />
              Save as launcher (one-click <span className="mono">run/&lt;id&gt;</span> link)
            </label>
            {!view.canSaveAsLauncher && <div style={{ color: 'var(--fg-3)' }}>Not available: a launcher would create the same branch every run.</div>}
            {save && view.canSaveAsLauncher && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input data-testid="launch-save-id" className="mono" value={saveId} onChange={(e) => setSaveId(e.target.value)} aria-label="Launcher id" style={{ flex: 1 }} />
                <input data-testid="launch-save-label" value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} aria-label="Launcher label" style={{ flex: 1 }} />
              </div>
            )}
          </div>
        )}
        {canUpdate && !expired && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--t-xs)' }}>
            <input data-testid="launch-update-toggle" type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
            Update launcher {view.launcherId} to this command (stops asking next time)
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={() => void onDiscard(view.id)}>{expired ? 'Dismiss' : 'Discard'}</Button>
          {expired ? (
            <span style={{ alignSelf: 'center', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>Expired</span>
          ) : (
            <button
              data-testid="launch-start"
              type="button"
              aria-disabled={!armed || busy}
              onClick={start}
              style={{
                position: 'relative', overflow: 'hidden', padding: '4px 14px', borderRadius: 6,
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
        </div>
      </div>
      <style>{'@keyframes launch-arm { from { width: 0 } to { width: 100% } }'}</style>
    </div>
  );
}
