import { useCallback, useEffect, useMemo, useState } from 'react';
import type { File as DiffFile } from 'parse-diff';
import { AlertCircle, CheckCircle, Circle, ExternalLink, Flag, Loader2, MinusCircle, Trash2 } from 'lucide-react';
import type { AppConfig, SessionInfo, WorktreeFinishInfo, WorktreeFinishStep } from '@argus/shared';
import { Button, Checkbox, LoadingState, Sheet, Icon } from '../../components/primitives/index.js';
import { api } from '../../services/api.js';
import { openExternal } from '../../utils/openExternal.js';
import { SplitDiff } from './SplitDiff.js';
import { defaultCommitMessage, fetchFinishState, type FinishState } from './finishWorktree.js';
import { isBetaEnabled } from '../../utils/betaFlags.js';

/**
 * Beta F8 — "Finish…" a worktree shell: commit, push and open a PR in one
 * confirm, with per-step progress, stopping at the first failure; and, once the
 * branch is merged, remove the worktree. Mounted only while
 * `betaWorktreeLifecycle` is on (ArgusApp gates it), so an off flag means no
 * sheet and no requests.
 */

const STEP_ORDER: readonly WorktreeFinishStep[] = ['commit', 'push', 'pr'];
const STEP_LABEL: Record<WorktreeFinishStep, string> = { commit: 'Commit', push: 'Push', pr: 'Open PR' };
type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';
interface StepState { status: StepStatus; detail?: string; url?: string }

interface FinishWorktreeSheetProps {
  session: SessionInfo;
  onClose: () => void;
  /** The worktree was removed (its session has already ended server-side). */
  onRemoved?: (session: SessionInfo) => void;
}

/** What ArgusApp mounts: the sheet, but only while the beta flag is on and a
 *  worktree shell was picked. Flag off ⇒ renders nothing and fetches nothing. */
export function FinishWorktreeHost({ config, session, onClose, onRemoved }: {
  config: Partial<AppConfig> | null | undefined;
  session: SessionInfo | null;
} & Omit<FinishWorktreeSheetProps, 'session'>) {
  if (!isBetaEnabled(config, 'betaWorktreeLifecycle') || !session?.worktreePath || !session.worktreeBranch) return null;
  return <FinishWorktreeSheet session={session} onClose={onClose} onRemoved={onRemoved} />;
}

export function FinishWorktreeSheet({ session, onClose, onRemoved }: FinishWorktreeSheetProps) {
  const [info, setInfo] = useState<WorktreeFinishInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [message, setMessage] = useState(() => defaultCommitMessage(session.worktreeBranch ?? ''));
  const [chosen, setChosen] = useState<Record<WorktreeFinishStep, boolean>>({ commit: false, push: true, pr: true });
  const [run, setRun] = useState<Partial<Record<WorktreeFinishStep, StepState>> | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const apply = useCallback((r: FinishState) => {
    if (!r.ok) { setLoadError(r.error); return; }
    setInfo(r.info);
    setLoadError(null);
    if (r.files) setFiles(r.files);
  }, []);

  const reload = useCallback(() => { void fetchFinishState(session.id).then(apply); }, [session.id, apply]);

  // First read also picks the default steps: Commit only when dirty, Open PR
  // only when no PR is open yet.
  useEffect(() => {
    let cancelled = false;
    void fetchFinishState(session.id).then((r) => {
      if (cancelled) return;
      apply(r);
      if (!r.ok) return;
      const open = r.info.pr?.state === 'open' || r.info.pr?.state === 'draft';
      setChosen({ commit: r.info.dirty, push: true, pr: !open });
    });
    return () => { cancelled = true; };
  }, [session.id, apply]);

  const prOpen = info?.pr?.state === 'open' || info?.pr?.state === 'draft';
  const available: Record<WorktreeFinishStep, boolean> = {
    commit: !!info?.dirty,
    push: !!info,
    pr: !!info && !prOpen,
  };
  const selected = STEP_ORDER.filter((s) => chosen[s] && available[s]);
  const messageMissing = selected.includes('commit') && !message.trim();
  const finished = run !== null && !running;
  const allOk = finished && selected.every((s) => run?.[s]?.status === 'ok');
  const canRun = !!info && selected.length > 0 && !messageMissing && !running && !allOk;

  const execute = async () => {
    const steps = selected;
    setRunning(true);
    setRun(Object.fromEntries(steps.map((s) => [s, { status: 'pending' }])));
    let failed = false;
    for (const step of steps) {
      if (failed) {
        setRun((cur) => ({ ...cur, [step]: { status: 'skipped' } }));
        continue;
      }
      setRun((cur) => ({ ...cur, [step]: { status: 'running' } }));
      let state: StepState;
      try {
        const res = await api.finishWorktree(session.id, [step], step === 'commit' ? message : undefined);
        const r = res.results[0];
        state = r ? { status: r.status, detail: r.detail, url: r.url } : { status: 'failed', detail: 'No result' };
      } catch (err) {
        state = { status: 'failed', detail: err instanceof Error ? err.message : 'Request failed' };
      }
      setRun((cur) => ({ ...cur, [step]: state }));
      if (state.status !== 'ok') failed = true;
    }
    setRunning(false);
    reload();
  };

  const remove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.removeFinishedWorktree(session.id);
      onRemoved?.(session);
      onClose();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Remove failed');
      setRemoving(false);
    }
  };

  const activeFile = useMemo(
    () => files.find((f) => fileName(f) === selectedFile) ?? files[0],
    [files, selectedFile],
  );

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%' }}>
      {info?.removable && !confirmRemove && (
        <Button variant="ghost" size="md" icon={Trash2} onClick={() => setConfirmRemove(true)} disabled={running}>
          Remove worktree…
        </Button>
      )}
      <div style={{ flex: 1 }} />
      <Button variant="ghost" size="md" onClick={onClose} disabled={running}>{finished ? 'Done' : 'Cancel'}</Button>
      <Button variant="primary" size="md" icon={Flag} onClick={() => { void execute(); }} disabled={!canRun} loading={running}>
        {selected.length === 0 ? 'Nothing selected' : `Run ${selected.map((s) => STEP_LABEL[s]).join(' → ')}`}
      </Button>
    </div>
  );

  return (
    <Sheet eyebrow="FINISH" title={session.worktreeBranch ?? session.name} width={760} onClose={running || removing ? undefined : onClose} footer={footer}>
      {loadError && <ErrorBox title="Could not read the worktree" text={loadError} />}
      {!info && !loadError && <LoadingState label="Reading the worktree…" />}
      {info && (
        <div data-testid="finish-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', alignItems: 'center', fontSize: 'var(--t-xs)' }}>
            <span className="argus-tile-branch" style={{ maxWidth: 'none' }}>{info.branch}</span>
            <span style={{ color: 'var(--fg-3)' }}>→</span>
            <span data-testid="finish-upstream" style={{ fontFamily: 'var(--font-mono)', color: info.upstream ? 'var(--fg-1)' : 'var(--fg-3)' }}>
              {info.upstream ?? 'no upstream yet (push will publish it)'}
            </span>
            {info.pr && (
              <button type="button" className="argus-link" onClick={() => openExternal(info.pr!.url)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)' }}>
                PR #{info.pr.number} · {info.pr.state}
              </button>
            )}
          </div>

          <section>
            <div className="eyebrow" style={{ color: 'var(--fg-3)', marginBottom: 'var(--s-2)' }}>
              UNCOMMITTED · {files.length}
            </div>
            {files.length === 0 ? (
              <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>Working tree clean.</div>
            ) : (
              <div style={{ display: 'flex', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', height: 240, overflow: 'hidden' }}>
                <aside className="argus-scroll" style={{ width: 220, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--line-2)', background: 'var(--bg-1)' }}>
                  {files.map((f) => {
                    const name = fileName(f);
                    const active = activeFile === f;
                    return (
                      <button
                        key={name}
                        type="button"
                        data-testid="finish-file"
                        onClick={() => setSelectedFile(name)}
                        style={{
                          all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box',
                          padding: 'var(--s-1) var(--s-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          background: active ? 'var(--bg-3)' : 'transparent', color: active ? 'var(--fg-0)' : 'var(--fg-1)',
                        }}
                      >
                        {name}
                      </button>
                    );
                  })}
                </aside>
                <main className="argus-scroll" style={{ flex: 1, overflow: 'auto', background: 'var(--bg-0)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', padding: 'var(--s-2)' }}>
                  {activeFile && activeFile.chunks.length > 0 ? <SplitDiff target={activeFile} /> : <span style={{ color: 'var(--fg-3)' }}>No diff preview.</span>}
                </main>
              </div>
            )}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
            <div className="eyebrow" style={{ color: 'var(--fg-3)' }}>STEPS</div>
            {STEP_ORDER.map((step) => (
              <StepRow
                key={step}
                step={step}
                checked={chosen[step] && available[step]}
                disabled={!available[step] || running || finished}
                hint={stepHint(step, info)}
                state={run?.[step]}
                onChange={(v) => setChosen((c) => ({ ...c, [step]: v }))}
              />
            ))}
            {available.commit && chosen.commit && (
              <label style={{ display: 'block' }}>
                <span className="eyebrow" style={{ color: 'var(--fg-2)' }}>Commit message</span>
                <textarea
                  data-testid="finish-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={running || finished}
                  rows={3}
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, resize: 'vertical',
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-0)',
                    background: 'var(--bg-inset)', border: `1px solid ${messageMissing ? 'var(--danger)' : 'var(--line-3)'}`,
                    borderRadius: 'var(--r-2)', padding: 'var(--s-2)',
                  }}
                />
              </label>
            )}
          </section>

          {info.merged && !info.removable && info.removeBlockedReason && (
            <div data-testid="finish-remove-blocked" style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>
              Can't remove the worktree yet: {info.removeBlockedReason}
            </div>
          )}

          {confirmRemove && (
            <div role="alertdialog" aria-label="Remove worktree" data-testid="finish-remove-confirm" style={{ padding: 'var(--s-3)', border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)', borderRadius: 'var(--r-3)', background: 'var(--danger-bg)' }}>
              <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)', marginBottom: 'var(--s-2)' }}>
                This ends the shell and runs <code>git worktree remove</code> on
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-1)', wordBreak: 'break-all' }}>{info.worktreePath}</div>
                The branch itself is kept.
              </div>
              {removeError && <ErrorBox title="Remove failed" text={removeError} />}
              <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end' }}>
                <Button variant="ghost" size="sm" onClick={() => { setConfirmRemove(false); setRemoveError(null); }} disabled={removing}>Keep it</Button>
                <Button variant="danger" size="sm" icon={Trash2} onClick={() => { void remove(); }} loading={removing}>Remove worktree</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function fileName(f: DiffFile): string {
  const to = f.to && f.to !== '/dev/null' ? f.to : undefined;
  return to ?? f.from ?? '(unknown)';
}

function stepHint(step: WorktreeFinishStep, info: WorktreeFinishInfo): string {
  if (step === 'commit') return info.dirty ? 'Stage everything and commit' : 'Nothing to commit';
  if (step === 'push') return info.upstream ? `git push to ${info.upstream}` : `Publish to origin/${info.branch}`;
  if (info.pr && (info.pr.state === 'open' || info.pr.state === 'draft')) return `PR #${info.pr.number} is already open`;
  if (info.ghAvailable) return `gh pr create --fill against ${info.defaultBranch}`;
  return info.compareUrl ? 'gh is not available — opens the GitHub compare page' : 'gh is not available and origin is not on GitHub';
}

const STATUS_ICON = { pending: Circle, running: Loader2, ok: CheckCircle, failed: AlertCircle, skipped: MinusCircle } as const;
const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'var(--fg-3)', running: 'var(--accent)', ok: 'var(--ok)', failed: 'var(--danger)', skipped: 'var(--fg-3)',
};

function StepRow({ step, checked, disabled, hint, state, onChange }: {
  step: WorktreeFinishStep;
  checked: boolean;
  disabled: boolean;
  hint: string;
  state?: StepState;
  onChange: (v: boolean) => void;
}) {
  const Glyph = state ? STATUS_ICON[state.status] : null;
  return (
    <div data-testid={`finish-step-${step}`} data-status={state?.status ?? 'idle'} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <Checkbox checked={checked} onChange={onChange} disabled={disabled} />
        <span style={{ fontSize: 'var(--t-sm)', color: disabled && !checked ? 'var(--fg-3)' : 'var(--fg-0)' }}>{STEP_LABEL[step]}</span>
        <span style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-3)', flex: 1, minWidth: 0 }}>{hint}</span>
        {Glyph && <Icon icon={Glyph} size={14} color={STATUS_COLOR[state!.status]} strokeWidth={1.8} aria-label={state!.status} />}
      </div>
      {state?.status === 'ok' && (state.detail || state.url) && (
        <div style={{ marginLeft: 24, fontSize: 'var(--t-tiny)', color: 'var(--fg-2)', display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          {state.detail && <span>{state.detail}</span>}
          {state.url && (
            <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => openExternal(state.url!)}>
              {state.url.includes('/compare/') ? 'Open compare page' : 'Open PR'}
            </Button>
          )}
        </div>
      )}
      {state?.status === 'failed' && <div style={{ marginLeft: 24 }}><ErrorBox title={`${STEP_LABEL[step]} failed`} text={state.detail ?? 'Unknown error'} /></div>}
    </div>
  );
}

function ErrorBox({ title, text }: { title: string; text: string }) {
  return (
    <div role="alert" style={{ padding: 'var(--s-2) var(--s-3)', background: 'var(--danger-bg)', border: '1px solid color-mix(in srgb, var(--danger) 33%, transparent)', borderRadius: 'var(--r-2)', marginBottom: 'var(--s-2)' }}>
      <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: 'var(--danger)' }}>{title}</div>
      <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>{text}</pre>
    </div>
  );
}
