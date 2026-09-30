import { useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { GitBranch, Trash2 } from 'lucide-react';
import { Section, Button, AlertSheet } from '../../../../components/primitives/index.js';
import { api } from '../../../../services/api.js';

/** Not a preferences pane — a janitor. It lists the worktrees Argus created and
 *  removes the ones whose work is done, which is why it carries no config keys. */
export function IsolationPane({ sessions }: { sessions: SessionInfo[] }) {
  const worktreeSessions = sessions.filter((s) => !!s.worktreeBranch);

  const [deleting, setDeleting] = useState<SessionInfo | null>(null);
  const [check, setCheck] = useState<{ isDirty?: boolean; isUnmerged?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteClick = async (session: SessionInfo) => {
    setError(null);
    setDeleting(session);
    try {
      // repoPath: for worktree sessions folderPath IS the worktree dir; we use it for git root resolution
      const result = await api.checkWorktree({
        repoPath: session.folderPath,
        worktreePath: session.folderPath,
        worktreeBranch: session.worktreeBranch,
      });
      setCheck({ isDirty: result.isDirty, isUnmerged: result.isUnmerged });
    } catch {
      setCheck({});
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteWorktree(deleting.folderPath, deleting.folderPath, check?.isDirty || false);
      setDeleting(null);
      setCheck(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete worktree');
    } finally {
      setBusy(false);
    }
  };

  const open = deleting !== null && check !== null;
  const warnings: string[] = [];
  if (check?.isDirty) warnings.push('This worktree has uncommitted changes.');
  if (check?.isUnmerged) warnings.push('This branch has unmerged commits.');
  const baseMsg = warnings.length > 0
    ? warnings.join(' ') + '\n\nDelete the worktree directory anyway?'
    : `Delete worktree "${deleting?.worktreeBranch ?? ''}"? This removes the directory but keeps the branch in git.`;
  const message = error ? `${baseMsg}\n\n${error}` : baseMsg;

  return (
    <>
      <div style={{ color: 'var(--fg-2)', fontSize: 'var(--t-sm)', lineHeight: 1.6, marginBottom: 'var(--s-5)' }}>
        Each isolated session runs in its own git worktree — a separate working directory branched off
        your repo. Changes stay sandboxed until you're ready to merge, so multiple agents can work in
        parallel without stepping on each other's files.
      </div>

      <Section title={`Active worktrees${worktreeSessions.length > 0 ? ` · ${worktreeSessions.length}` : ''}`}>
        {worktreeSessions.length === 0 ? (
          <div className="settings-card-pad" style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
            No worktree sessions yet — create a session with isolation enabled and it shows up here.
          </div>
        ) : (
          worktreeSessions.map((s, i) => {
            const isLive = s.status !== 'exited';
            const last = i === worktreeSessions.length - 1;
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-3)',
                  padding: 'var(--s-3) var(--s-4)',
                  borderBottom: last ? 'none' : '1px solid var(--line-1)',
                }}
              >
                <GitBranch size={14} strokeWidth={1.6} color="var(--accent)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-0)', fontWeight: 500 }}>
                    {s.worktreeBranch}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.folderPath}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', flexShrink: 0 }}>
                  <span style={{
                    fontSize: 'var(--t-micro)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: 'var(--tracking-eye)',
                    color: isLive ? 'var(--status-running)' : 'var(--fg-3)',
                  }}>
                    {s.name} · {s.status}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLive}
                    onClick={() => void handleDeleteClick(s)}
                    title={isLive ? 'Close session first' : 'Delete worktree'}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </Section>

      <AlertSheet
        isOpen={open}
        title="Delete worktree?"
        message={message}
        confirmLabel="Delete worktree"
        confirmDestructive
        confirmLoading={busy}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => { setDeleting(null); setCheck(null); setError(null); }}
      />
    </>
  );
}
