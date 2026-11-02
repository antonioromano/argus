import { useCallback, useEffect, useState } from 'react';
import type { OrphanReport } from '@argus/shared';
import { AlertSheet, Section, Button, Checkbox, pushToast, Stack, Row, Text } from '../../../../components/primitives/index.js';
import { toastError } from '../../../../errors/toastError.js';
import { PaneLoadState } from '../PaneLoadState.js';
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
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => api.getOrphans().then(
    (r) => {
      setReport(r);
      setError(null);
      setSelected((prev) => new Set([...prev].filter((p) => r.daemons.some((d) => d.pid === p))));
    },
    (err: unknown) => setError(err ?? new Error('Scan failed')),
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
      toastError(err, 'Couldn’t stop the daemons');
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
      title="Agents without a session"
      action={<Button size="sm" variant="ghost" onClick={() => { void refresh(); }}>Rescan</Button>}
    >
      <Stack gap={3} className="settings-card-pad" style={{ fontSize: 'var(--t-xs)' }}>
        <PaneLoadState loaded={report !== null} error={error} errorTitle="Couldn’t scan for agents without a session" onRetry={() => { void refresh(); }} />
        {report && !error && daemons.length === 0 && (
          <p style={{ margin: 0, color: 'var(--fg-3)' }}>No stray agents or session hosts. Only the active session host is running.</p>
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
                <Row align="start" gap={2} key={d.pid} data-testid="orphan-daemon">
                  <Checkbox checked={selected.has(d.pid)} onChange={(v) => toggle(d.pid, v)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: 'var(--fg-0)' }}>
                      {d.kind === 'argusd' ? 'argusd' : 'tmux'} · {d.label} · pid {d.pid} · {formatKb(d.treeRssKb)}
                    </div>
                    {agents.length === 0 && <Text as="div" tone="faint">no agents (child pids: {d.childPids.join(', ') || 'none'})</Text>}
                    {agents.map((a) => (
                      <Text as="div" key={a.pid} tone="muted" truncate title={a.command}>
                        {a.agent} · pid {a.pid} · {formatKb(a.rssKb)}{a.cwd ? ` · ${a.cwd}` : ''}
                      </Text>
                    ))}
                  </div>
                </Row>
              );
            })}
            <Row justify="end" gap={2}>
              <Button size="sm" variant="danger" disabled={selected.size === 0} onClick={() => setConfirming(true)}>
                Kill selected…
              </Button>
            </Row>
          </>
        )}
      </Stack>
      {/* Killing processes is irreversible: a decision sheet, not an inline row
          (docs/design/feedback-surfaces.md). */}
      <AlertSheet
        isOpen={confirming}
        title={`Stop ${selected.size} daemon(s) and their agents?`}
        message={`This kills their whole process trees and frees about ${formatKb(selectedRss)}. Sessions in this app are not touched.`}
        confirmLabel="Kill"
        confirmDestructive
        confirmLoading={busy}
        onConfirm={() => { void kill(); }}
        onCancel={() => setConfirming(false)}
      />
    </Section>
  );
}
