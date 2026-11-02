import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Copy, ExternalLink, RefreshCw, RotateCcw, Settings } from 'lucide-react';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { pushToast } from './Toast.js';
import { describeError, type DescribedError } from '../../errors/describeError.js';
import {
  availableActions,
  errorActionLabel,
  runErrorAction,
  useErrorActionHostVersion,
  type ErrorAction,
} from '../../errors/errorActions.js';

/** Empty state: one sentence (`title`, optional `hint`) and at most one `action`. */
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Glyph, title, hint, action }: EmptyStateProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: 'var(--s-8) var(--s-6)',
      gap: 'var(--s-3)',
      color: 'var(--fg-2)',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: '1px dashed var(--line-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-3)',
      }}>
        <Icon icon={Glyph} size={24} />
      </div>
      <div style={{ fontSize: 'var(--t-md)', color: 'var(--fg-0)', fontWeight: 500 }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--t-sm)', maxWidth: 280 }}>{hint}</div>}
      {action}
    </div>
  );
}

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Connecting' }: LoadingStateProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--s-3)',
      color: 'var(--fg-2)',
    }}>
      <div style={{ display: 'inline-flex', gap: 'var(--s-1)' }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 16,
              background: 'var(--accent)',
              animation: `argus-pulse-bar 1.2s ease-in-out ${i * 0.12}s infinite`,
            }}
          />
        ))}
      </div>
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>
        {label}
        <span style={{ animation: 'argus-blink 1s infinite' }}>_</span>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  /** Headline. Defaults to the described error's title, else "Something went wrong". */
  title?: string;
  /** Raw text. With `error`/`described` it goes behind the Details disclosure;
   *  on its own (legacy callers) it stays visible. */
  detail?: string;
  /** Any thrown value: described through the error table (code → cause + actions). */
  error?: unknown;
  /** An already-described error (wins over `error`). */
  described?: DescribedError;
  /** Headline used only when `error` has no typed code (unlike `title`, which always wins). */
  fallbackTitle?: string;
  onRetry?: () => void;
}

const ERROR_FALLBACK_TITLE = 'Something went wrong';

/** The error's actions as buttons; ones nothing can run are not rendered. */
export function ErrorActions({ actions, onRetry }: { actions: ErrorAction[]; onRetry?: () => void }) {
  useErrorActionHostVersion();
  const runnable = availableActions(actions, { onRetry });
  if (runnable.length === 0) return null;
  return (
    <div className="argus-error-actions">
      {runnable.map((action, i) => (
        <Button
          key={`${action.kind}-${i}`}
          variant={action.kind === 'retry' ? 'outline' : i === 0 ? 'primary' : 'secondary'}
          size="sm"
          icon={ACTION_ICON[action.kind]}
          onClick={() => {
            void runErrorAction(action, { onRetry }).then((ran) => {
              if (ran && action.kind === 'copy-command') pushToast(`Copied “${action.command}”`, 'ok');
            }, () => pushToast('Couldn’t copy to the clipboard', 'warn'));
          }}
        >
          {errorActionLabel(action)}
        </Button>
      ))}
    </div>
  );
}

const ACTION_ICON: Partial<Record<ErrorAction['kind'], LucideIcon>> = {
  retry: RefreshCw,
  'copy-command': Copy,
  'open-url': ExternalLink,
  'open-settings': Settings,
  'restart-session': RotateCcw,
};

export function ErrorState({ title, detail, error, described, fallbackTitle, onRetry }: ErrorStateProps) {
  useErrorActionHostVersion();
  const d = described ?? (error !== undefined && error !== null ? describeError(error, { fallbackTitle: title ?? fallbackTitle }) : undefined);
  const headline = title ?? d?.title ?? ERROR_FALLBACK_TITLE;
  const hidden = d ? (detail ?? d.detail) : undefined;
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--s-3)',
      padding: 'var(--s-6)',
      textAlign: 'center',
    }}>
      <div style={{
        padding: 'var(--s-1-5) var(--s-3)',
        background: 'var(--danger-bg)',
        color: 'var(--danger)',
        border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
        borderRadius: 'var(--r-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        letterSpacing: 'var(--tracking-eye)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--s-1-5)',
      }}>
        <Icon icon={AlertTriangle} size="sm" /> ERROR
      </div>
      <div style={{ fontSize: 'var(--t-md)', color: 'var(--fg-0)', fontWeight: 500 }}>{headline}</div>
      {d && <div className="argus-error-cause">{d.cause}</div>}
      {!d && detail && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
          color: 'var(--fg-2)',
          background: 'var(--bg-inset)',
          padding: 'var(--s-2) var(--s-3)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-2)',
          maxWidth: 360,
          textAlign: 'left',
        }}>
          {detail}
        </div>
      )}
      {d
        ? <ErrorActions actions={d.actions} onRetry={onRetry} />
        : onRetry && <Button variant="outline" icon={RefreshCw} size="sm" onClick={onRetry}>Retry</Button>}
      {hidden && hidden !== headline && (
        <details className="argus-error-details">
          <summary>Details</summary>
          <pre>{hidden}</pre>
        </details>
      )}
    </div>
  );
}

interface InlineErrorStateProps {
  /** Any thrown value, described through the error table. */
  error: unknown;
  /** Headline used only when `error` has no typed code. */
  fallbackTitle?: string;
  onRetry?: () => void;
}

/**
 * The error state for a section inside a larger surface (a settings pane, an
 * inspector block): headline, cause, actions and collapsed Details, aligned
 * with the section's text instead of centred in the pane.
 */
export function InlineErrorState({ error, fallbackTitle, onRetry }: InlineErrorStateProps) {
  useErrorActionHostVersion();
  const d = describeError(error, { fallbackTitle });
  return (
    <div className="argus-inline-surface-error" role="alert">
      <div className="argus-inline-surface-error-title">{d.title}</div>
      <div className="argus-error-cause">{d.cause}</div>
      <ErrorActions actions={d.actions} onRetry={onRetry} />
      {d.detail && d.detail !== d.title && (
        <details className="argus-error-details">
          <summary>Details</summary>
          <pre>{d.detail}</pre>
        </details>
      )}
    </div>
  );
}

interface StaleNoticeProps {
  /** Why the refresh failed; its title is named in the line. */
  error?: unknown;
  /** What is being kept, e.g. "the last reading". */
  subject?: string;
  onRetry?: () => void;
}

/**
 * One line above data whose last refresh failed (the "stale" state). Fixed
 * height (CSS), so appearing or disappearing never reflows the rows below it
 * by more than its own line, and hover never resizes it.
 */
export function StaleNotice({ error, subject = 'the last reading', onRetry }: StaleNoticeProps) {
  const reason = error !== undefined && error !== null ? describeError(error).title : 'The refresh failed';
  const message = `${reason}. Showing ${subject}.`;
  return (
    <div className="argus-stale-notice" role="status" title={message}>
      <Icon icon={AlertTriangle} size="sm" />
      <span className="argus-stale-notice-text">{message}</span>
      {onRetry && (
        <button type="button" className="argus-stale-notice-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
