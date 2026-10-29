import type { ReactNode } from 'react';
import { pushToast } from '../../components/primitives/index.js';
import { describeError } from '../../errors/describeError.js';
import {
  availableActions,
  errorActionLabel,
  runErrorAction,
  useErrorActionHostVersion,
  type ErrorAction,
} from '../../errors/errorActions.js';
import type { PaneId } from '../overlays/settings/registry.js';

/** A label / value line inside an inspector section. */
export function InspectorRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="argus-inspector-row" title={title}>
      <span className="argus-inspector-label">{label}</span>
      <span className="argus-inspector-value">{children}</span>
    </div>
  );
}

/** Muted one-liner for a section with nothing to show, with an optional
 *  inline action (link-styled, so it never changes the line's height). */
export function InspectorEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="argus-inspector-empty">
      {children}
      {action && <> {action}</>}
    </div>
  );
}

function runAction(action: ErrorAction, onRetry?: () => void): void {
  void runErrorAction(action, { onRetry }).then((ran) => {
    if (ran && action.kind === 'copy-command') pushToast(`Copied “${action.command}”`, 'ok');
  }, () => pushToast('Couldn’t copy to the clipboard', 'warn'));
}

/** An error action as an inline link. */
export function InspectorActionLink({ action, onRetry }: { action: ErrorAction; onRetry?: () => void }) {
  return (
    <button type="button" className="argus-inspector-link" onClick={() => runAction(action, onRetry)}>
      {errorActionLabel(action)}
    </button>
  );
}

/** "Open Settings → <pane>" as an inline link. */
export function InspectorSettingsLink({ pane }: { pane: PaneId }) {
  useErrorActionHostVersion();
  const action: ErrorAction = { kind: 'open-settings', pane };
  if (availableActions([action]).length === 0) return null;
  return <InspectorActionLink action={action} />;
}

/**
 * A section's failure in the inspector's one-line style: the described title
 * and cause (never the raw message), then its runnable actions as links.
 * `stale` keeps the data below and says so.
 */
export function InspectorError({ error, fallbackTitle, onRetry, stale }: {
  error: unknown;
  fallbackTitle: string;
  onRetry?: () => void;
  stale?: boolean;
}) {
  useErrorActionHostVersion();
  const d = describeError(error, { fallbackTitle });
  const actions = availableActions(d.actions, { onRetry });
  const text = stale ? `${d.title}. Showing the last reading.` : `${d.title}. ${d.cause}`;
  return (
    <div className="argus-inspector-empty" role={stale ? 'status' : 'alert'} title={d.detail}>
      {text}
      {actions.map((a, i) => (
        <span key={`${a.kind}-${i}`}> <InspectorActionLink action={a} onRetry={onRetry} /></span>
      ))}
    </div>
  );
}
