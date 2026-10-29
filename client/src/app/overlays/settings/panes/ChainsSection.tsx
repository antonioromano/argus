import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ChainFire, SessionChain, SessionInfo } from '@argus/shared';
import { IconButton, Section, Toggle } from '../../../../components/primitives/index.js';
import { toastError } from '../../../../errors/toastError.js';
import { PaneLoadState } from '../PaneLoadState.js';
import { useSocket } from '../../../../hooks/useSocket.js';
import { api } from '../../../../services/api.js';
import { shellLabel } from '../../../../utils/sessionLabel.js';
import { useDeferredRemove } from '../../../../hooks/useDeferredRemove.js';

/**
 * Beta F13: every chain (armed state, why it disarmed, remove) and the last
 * fires (sent / queued / dropped + reason). Rendered by BetaPane only while
 * `betaSessionChains` is on; new chains are made from a shell's "Chain to…".
 */
export function ChainsSection() {
  const socket = useSocket();
  const [chains, setChains] = useState<SessionChain[] | null>(null);
  const [fires, setFires] = useState<ChainFire[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);

  const refetch = useCallback(() => {
    Promise.all([api.listChains(), api.chainAudit(), api.getSessions()])
      .then(([c, f, sessions]) => {
        setChains(c);
        setFires(f);
        setNames(Object.fromEntries(sessions.map((s: SessionInfo) => [s.id, shellLabel(s)])));
        setError(null);
      })
      .catch((err: unknown) => setError(err ?? new Error('Couldn’t load chains')));
  }, []);

  useEffect(() => {
    refetch();
    socket.on('chains:changed', refetch);
    return () => { socket.off('chains:changed', refetch); };
  }, [socket, refetch]);

  const name = (id: string, fallback?: string) => names[id] ?? fallback ?? id.slice(0, 8);

  const setArmed = async (c: SessionChain, armed: boolean) => {
    try {
      const next = await api.setChainArmed(c.id, armed);
      setChains((list) => list?.map((x) => (x.id === c.id ? next : x)) ?? null);
    } catch (err) {
      toastError(err, 'Couldn’t update the chain');
    }
  };

  // Deferred: re-creating a chain would lose its armed state and fire history.
  const { hidden, remove: deferRemove } = useDeferredRemove();
  const remove = (c: SessionChain) => deferRemove(c.id, {
    message: `Removed chain ${name(c.sourceId)} → ${name(c.targetId)}`,
    commit: () => api.deleteChain(c.id),
    onCommitted: () => setChains((list) => list?.filter((x) => x.id !== c.id) ?? null),
  });
  const visible = chains?.filter((c) => !hidden.has(c.id));

  return (
    <Section title="Chains">
      <div data-testid="chains-section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
        <PaneLoadState loaded={chains !== null} error={error} errorTitle="Couldn’t load chains" onRetry={refetch} />
        {visible && visible.length === 0 && !error && (
          <div className="setting-row-hint">No chains yet. Right-click a shell → Chain to… to add one.</div>
        )}
        {visible?.map((c) => (
          <div key={c.id} className="setting-row" data-testid={`chain-${c.id}`}>
            <div className="setting-row-meta" style={{ minWidth: 0 }}>
              <div className="setting-row-label">
                {name(c.sourceId)} → {name(c.targetId)}
                <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}> · on {c.trigger} · {c.mode}{c.fireCount > 0 ? ` · fired ${c.fireCount}×` : ''}</span>
              </div>
              <div className="setting-row-hint" style={{ fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.prompt}>
                {c.prompt}
              </div>
              {!c.armed && c.disarmedReason && (
                <div className="setting-row-hint" data-testid="chain-reason" style={{ color: 'var(--warn, var(--fg-2))' }}>
                  Disarmed: {c.disarmedReason}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', flexShrink: 0 }}>
              <Toggle checked={c.armed} onChange={(v) => { void setArmed(c, v); }} label={c.armed ? 'Armed' : 'Disarmed'} size="sm" />
              <IconButton icon={Trash2} label="Remove chain" size="sm" onClick={() => remove(c)} />
            </div>
          </div>
        ))}

        {fires.length > 0 && (
          <div data-testid="chain-fires" style={{ marginTop: 'var(--s-2)' }}>
            <div className="eyebrow" style={{ color: 'var(--fg-2)', marginBottom: 'var(--s-1)' }}>Recent fires</div>
            {fires.map((f, i) => (
              <div key={`${f.at}-${i}`} style={{ display: 'flex', gap: 'var(--s-2)', fontSize: 'var(--t-xs)', color: 'var(--fg-2)', lineHeight: 1.6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', flexShrink: 0 }}>{new Date(f.at).toLocaleTimeString()}</span>
                <span style={{ flexShrink: 0, color: f.outcome === 'dropped' ? 'var(--danger)' : f.outcome === 'sent' ? 'var(--fg-0)' : 'var(--fg-2)' }}>{f.outcome}</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name(f.sourceId, f.sourceName)} → {name(f.targetId, f.targetName)}{f.reason ? ` · ${f.reason}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
