import { useSyncExternalStore } from 'react';
// Type-only: the primitives layer must not pull the settings registry (and its
// catalog) in at runtime.
import type { PaneId } from '../app/overlays/settings/registry.js';
import { openExternal } from '../utils/openExternal.js';

/**
 * What an error surface can offer the user as a next step. The client picks
 * these from the error's typed code (errorCopy.ts), never from message text.
 */
export type ErrorAction =
  | { kind: 'retry' }
  | { kind: 'open-settings'; pane: PaneId }
  /** Copies a shell command (e.g. `brew install gh`). Argus never runs installs itself. */
  | { kind: 'copy-command'; command: string }
  | { kind: 'open-url'; url: string; label?: string }
  | { kind: 'restart-session'; sessionId: string }
  /** Hidden until plan 002 registers a handler. */
  | { kind: 'report-issue' };

export type ErrorActionKind = ErrorAction['kind'];

type Handler<K extends ErrorActionKind> = (action: Extract<ErrorAction, { kind: K }>) => void | Promise<void>;

/** Handlers an app shell supplies for the actions only it can perform. */
export type ErrorActionHandlers = { [K in ErrorActionKind]?: Handler<K> };

/** Per-surface context: Retry is the surface's own, never the host's. */
export interface ErrorActionContext {
  onRetry?: () => void;
}

/** Actions any renderer can run without an app shell. */
const BUILT_IN: ErrorActionHandlers = {
  'copy-command': (a) => navigator.clipboard.writeText(a.command),
  'open-url': (a) => openExternal(a.url),
};

// Registered hosts, newest last. ArgusApp registers on mount; plan 002 will add
// report-issue the same way. Same external-setter idea as pushToast.
const hosts: ErrorActionHandlers[] = [];
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const l of listeners) l();
}

/** Register handlers; returns the unregister function. */
export function registerErrorActionHost(handlers: ErrorActionHandlers): () => void {
  hosts.push(handlers);
  changed();
  return () => {
    const i = hosts.indexOf(handlers);
    if (i >= 0) hosts.splice(i, 1);
    changed();
  };
}

function handlerFor(kind: ErrorActionKind): Handler<ErrorActionKind> | undefined {
  for (let i = hosts.length - 1; i >= 0; i--) {
    const h = hosts[i][kind];
    if (h) return h as Handler<ErrorActionKind>;
  }
  if (kind === 'copy-command' && typeof navigator !== 'undefined' && !navigator.clipboard) return undefined;
  return BUILT_IN[kind] as Handler<ErrorActionKind> | undefined;
}

/** Whether `action` has something to run it: a button with none is not rendered. */
export function canRunErrorAction(action: ErrorAction, ctx?: ErrorActionContext): boolean {
  if (action.kind === 'retry') return !!ctx?.onRetry;
  return !!handlerFor(action.kind);
}

/** The runnable subset of `actions`, order kept. */
export function availableActions(actions: readonly ErrorAction[], ctx?: ErrorActionContext): ErrorAction[] {
  return actions.filter((a) => canRunErrorAction(a, ctx));
}

/** Run `action`. Resolves false when nothing could run it. */
export async function runErrorAction(action: ErrorAction, ctx?: ErrorActionContext): Promise<boolean> {
  if (action.kind === 'retry') {
    if (!ctx?.onRetry) return false;
    ctx.onRetry();
    return true;
  }
  const handler = handlerFor(action.kind);
  if (!handler) return false;
  await handler(action);
  return true;
}

/** Settings pane names for "Open Settings → X" labels. Kept equal to the
 *  registry's labels by errorActions.test.ts. */
export const SETTINGS_PANE_LABEL: Readonly<Record<PaneId, string>> = {
  theme: 'Theme & layout',
  'shell-header': 'Shell header',
  agents: 'Agents',
  isolation: 'Isolation',
  launchers: 'Launchers',
  general: 'General',
  'auto-approval': 'Auto-approval',
  notifications: 'Notifications',
  keyboard: 'Keyboard',
  runtime: 'Runtime',
  remote: 'Remote access',
  beta: 'Beta features',
};

/** Button text for an action. */
export function errorActionLabel(action: ErrorAction): string {
  switch (action.kind) {
    case 'retry': return 'Retry';
    case 'open-settings': return `Open Settings → ${SETTINGS_PANE_LABEL[action.pane] ?? action.pane}`;
    case 'copy-command': return `Copy “${action.command}”`;
    case 'open-url': return action.label ?? 'Open in browser';
    case 'restart-session': return 'Restart session';
    case 'report-issue': return 'Report issue';
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-render when a host registers or unregisters (so buttons appear once ArgusApp mounts). */
export function useErrorActionHostVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
