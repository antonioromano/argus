import { useState } from 'react';
import type { SessionInfo, SessionPrDiffResponse, SessionPrEntry } from '@argus/shared';
import { AlignLeft, ExternalLink, GitPullRequest, RefreshCw, SplitSquareHorizontal, X } from 'lucide-react';
import { usePrDiff } from '../../hooks/usePrDiff.js';
import { useLastSessionPrs } from '../../hooks/useSessionPrs.js';
import { workRoot } from '../../utils/workRoot.js';
import { openExternal } from '../../utils/openExternal.js';
import { PR_STATE_ICON, PR_STATE_LABEL, PR_TONE_COLOR, prRef, prTone } from '../../utils/prFormat.js';
import { ErrorState, Icon, IconButton, LoadingState } from '../../components/primitives/index.js';
import { ReadOnlyDiff } from './ReadOnlyDiff.js';

interface PrDiffViewProps {
  session: SessionInfo;
  /** The PR, as the Inspector's GitHub card listed it. */
  entry: SessionPrEntry;
  /** Close the tool window (return to the shell). */
  onClose: () => void;
}

/**
 * One pull request's changed files and diff (B4), opened from the Session
 * Inspector's GitHub card. Full-view over the shell like the Diff and Files tool windows;
 * read-only — the diff comes from GitHub (`gh pr diff`), not the work tree.
 */
export function PrDiffView({ session, entry, onClose }: PrDiffViewProps) {
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const { diff, error, refresh } = usePrDiff(session.id, entry.url);
  // The card keeps polling while open: show its latest reading of the PR.
  const key = entry.url.toLowerCase();
  const live = useLastSessionPrs(session.id)?.find((e) => e.url.toLowerCase() === key);
  const pr = live?.pr ?? entry.pr;
  const ref = prRef(entry.url, pr?.number);

  let body: React.ReactNode;
  if (error && !diff) body = <ErrorState title="Couldn’t read the pull request’s changes" detail={error} onRetry={refresh} />;
  else if (!diff) body = <LoadingState label="Loading pull request changes" />;
  else {
    body = (
      <ReadOnlyDiff
        key={diff.url}
        diff={diff.diff}
        sessionId={session.id}
        folderPath={workRoot(session)}
        mode={mode}
        notice={diff.truncated && <TruncatedNotice truncated={diff.truncated} />}
        empty={(
          <div className="argus-rodiff-empty">
            {diff.truncated ? 'This pull request’s diff is too large to display.' : 'This pull request changes no files.'}
          </div>
        )}
      />
    );
  }

  return (
    <div className="argus-prdiff">
      <div className="argus-prdiff-head">
        <Icon icon={pr ? PR_STATE_ICON[pr.state] : GitPullRequest} size={14} strokeWidth={1.6} color={pr ? PR_TONE_COLOR[prTone(pr)] : 'var(--fg-3)'} />
        <div className="eyebrow argus-prdiff-eyebrow" style={{ color: 'var(--accent)' }}>ARGUS · PULL REQUEST</div>
        <span className="argus-prdiff-title" title={pr?.title || ref}>{pr?.title || ref}</span>
        {pr?.title && <span className="argus-prdiff-ref">{ref}</span>}
        {pr && <span className="argus-inspector-pr-badge" data-tone={prTone(pr)}>{PR_STATE_LABEL[pr.state]}</span>}
        <div style={{ flex: 1 }} />
        <span className="argus-prdiff-readonly" title="Changes as GitHub has them; nothing here edits the pull request">read-only</span>
        <div className="argus-prdiff-mode" role="group" aria-label="Diff layout">
          <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>
            <Icon icon={SplitSquareHorizontal} size={11} strokeWidth={1.6} /> SPLIT
          </button>
          <button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>
            <Icon icon={AlignLeft} size={11} strokeWidth={1.6} /> UNIFIED
          </button>
        </div>
        <IconButton icon={ExternalLink} label="Open on GitHub" size="sm" onClick={() => openExternal(entry.url)} />
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={refresh} />
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>
      {/* A failed refresh: the last reading stays, the error goes above it. */}
      {error && diff && (
        <div className="argus-prdiff-notice argus-prdiff-stale" role="alert">
          Couldn’t refresh — showing the last reading. {error}
          <button type="button" className="argus-prdiff-retry" onClick={refresh}>Retry</button>
        </div>
      )}
      <div className="argus-prdiff-body">{body}</div>
    </div>
  );
}

/** Above the file list when the diff was too large: the paths, so the PR still reads. */
function TruncatedNotice({ truncated }: { truncated: NonNullable<SessionPrDiffResponse['truncated']> }) {
  const mb = Math.round(truncated.limitBytes / (1024 * 1024));
  return (
    <div className="argus-prdiff-notice" role="note">
      The diff is larger than {mb} MB and isn’t shown.
      {truncated.files.length === 0
        ? ' Open it on GitHub to see the changes.'
        : truncated.complete
          ? ` Files changed (${truncated.files.length}):`
          : ` The first ${truncated.files.length} files changed — the list is incomplete, open it on GitHub for the rest:`}
      {truncated.files.length > 0 && (
        <ul className="argus-prdiff-notice-files">
          {truncated.files.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}
