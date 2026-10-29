import type { ArgusErrorCode } from '@argus/shared';
import { ApiError } from '../services/api.js';
import { availableActions, type ErrorAction } from './errorActions.js';
import { ERROR_COPY, GENERIC_COPY, STATUS_COPY, isArgusErrorCode, resolveText, type CopyEntry, type ErrorParams } from './errorCopy.js';

/** What an error surface renders: never the raw message as the headline. */
export interface DescribedError {
  code?: ArgusErrorCode;
  title: string;
  cause: string;
  /** Fix-it actions with a handler, primary first; `retry` last when retryable
   *  (the surface renders it only if it can retry). */
  actions: ErrorAction[];
  /** Raw output (stderr, errno, the server's message) for a collapsed Details. */
  detail?: string;
  retryable: boolean;
}

export interface DescribeOptions {
  /** Headline for errors without a code, e.g. "Couldn’t load activity". */
  fallbackTitle?: string;
}

function rawMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message || undefined;
  if (typeof err === 'string') return err || undefined;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : undefined;
}

function build(entry: CopyEntry, params: ErrorParams, code: ArgusErrorCode | undefined, detail: string | undefined, title?: string): DescribedError {
  const fixes = availableActions(entry.actions?.(params) ?? []);
  return {
    ...(code ? { code } : {}),
    title: title ?? resolveText(entry.title, params),
    cause: resolveText(entry.cause, params),
    actions: entry.retryable ? [...fixes, { kind: 'retry' }] : fixes,
    ...(detail ? { detail } : {}),
    retryable: entry.retryable,
  };
}

/**
 * Turn any thrown value into title + cause + actions.
 * - A coded ApiError (or any object with a known `code`) goes through ERROR_COPY.
 * - An uncoded ApiError falls back by status (404 / 409 / 503 / 504), else generic.
 * - A `TypeError` from fetch is SERVER_UNREACHABLE.
 * - Anything else is generic, with its message as `detail`.
 * Actions with no registered handler are left out (e.g. report-issue before plan 002).
 */
export function describeError(err: unknown, opts: DescribeOptions = {}): DescribedError {
  const message = rawMessage(err);
  const e = (err ?? {}) as { code?: unknown; detail?: unknown; params?: unknown };
  const params: ErrorParams = e.params && typeof e.params === 'object' ? e.params as ErrorParams : {};
  const detail = (typeof e.detail === 'string' && e.detail) || message;

  if (isArgusErrorCode(e.code)) return build(ERROR_COPY[e.code], params, e.code, detail);
  if (err instanceof TypeError) return build(ERROR_COPY.SERVER_UNREACHABLE, params, 'SERVER_UNREACHABLE', detail);
  if (err instanceof ApiError && STATUS_COPY[err.status]) return build(STATUS_COPY[err.status], params, undefined, detail, opts.fallbackTitle);
  return build(GENERIC_COPY, params, undefined, detail, opts.fallbackTitle);
}
