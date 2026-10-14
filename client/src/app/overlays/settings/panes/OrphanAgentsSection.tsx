import { useCallback, useEffect, useState } from 'react';
import type { OrphanReport } from '@argus/shared';
import { Section, Button, Checkbox, pushToast } from '../../../../components/primitives/index.js';
import { api } from '../../../../services/api.js';

function formatKb(kb: number): string {
  const mb = kb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * F16: daemons on this data dir that are not the active backend, with the
 * agents they still run. Selection is per daemon: killing one stops its whole
 * process tree. The server re-validates every pid, so a stale list is harmless.
 */
export function OrphanAgentsSection() {
  const [report, setReport] = useState<OrphanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => api.getOrphans().then(
    (r) => {
      setReport(r);
      setError(null);
      setSelected((prev) => new Set([...prev].filter((p) => r.daemons.some((d) => d.pid === p))));
    },
    (err: unknown) => setError(err instanceof Error ? err.message : 'Scan failed'),
  ), []);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = (pid: number, on: boolean) => {
    setConfirming(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(pid);
      else next.delete(pid);
      return next;
    });
  };

  const kill = async () => {
    setBusy(true);
    try {
      const res = await api.killOrphans([...selected]);
      pushToast(`Stopped ${res.accepted.length} daemon(s)`, 'ok');
      setSelected(new Set());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Kill failed', 'danger');
    } finally {
      setBusy(false);
      setConfirming(false);
      await refresh();
    }
  };

  const daemons = report?.daemons ?? [];
  const selectedRss = daemons.filter((d) => selected.has(d.pid)).reduce((s, d) => s + d.treeRssKb, 0);

  return (
    <Section
      title="Orphan agents"
      action={<Button size="sm" variant="ghost" onClick={() => { void refresh(); }}>Rescan</Button>}
    >
      <div className="settings-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)', fontSize: 'var(--t-xs)' }}>
        {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
        {!error && !report && <p style={{ margin: 0, color: 'var(--fg-3)' }}>Scanning…</p>}
        {report && daemons.length === 0 && (
          <p style={{ margin: 0, color: 'var(--fg-3)' }}>No orphan daemons or agents. Only the active backend is running.</p>
        )}
        {daemons.length > 0 && (
          <>
            <p style={{ margin: 0, color: 'var(--fg-2)', lineHeight: 1.5 }}>
              {daemons.length} daemon(s) on this data dir are not used by this app, holding{' '}
              <strong data-testid="orphan-total">{formatKb(report!.totalRssKb)}</strong>. Their agents may duplicate your sessions.
            </p>
            {daemons.map((d) => {
              const agents = report!.agents.filter((a) => a.daemonPid === d.pid);
              return (
                <div key={d.pid} data-testid="orphan-daemon" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Checkbox checked={selected.has(d.pid)} onChange={(v) => toggle(d.pid, v)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: 'var(--fg-0)' }}>
                      {d.kind === 'argusd' ? 'argusd' : 'tmux'} · {d.label} · pid {d.pid} · {formatKb(d.treeRssKb)}
                    </div>
                    {agents.length === 0 && <div style={{ color: 'var(--fg-3)' }}>no agents (child pids: {d.childPids.join(', ') || 'none'})</div>}
                    {agents.map((a) => (
                      <div key={a.pid} style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.command}>
                        {a.agent} · pid {a.pid} · {formatKb(a.rssKb)}{a.cwd ? ` · ${a.cwd}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              {confirming ? (
                <>
                  <span style={{ color: 'var(--fg-1)' }}>
                    Stop {selected.size} daemon(s) and their agents ({formatKb(selectedRss)})?
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
                  <Button size="sm" variant="danger" onClick={() => { void kill(); }} loading={busy}>Kill</Button>
                </>
              ) : (
                <Button size="sm" variant="danger" disabled={selected.size === 0} onClick={() => setConfirming(true)}>
                  Kill selected
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
