import path from 'path';
import type { Response } from 'express';
import type { ApiErrorBody, ArgusErrorCode } from '@argus/shared';

/**
 * A failure classified for the client: an HTTP status, an optional typed
 * `code` (the client maps it to a cause + next actions), the raw tool output
 * as `detail`, and the `params` the client's copy needs. Server-only.
 *
 * `ArgusErrorCode` is imported as a TYPE: a value import of @argus/shared
 * crashes the packaged app at launch (CLAUDE.md, Key Details).
 */
export class ArgusError extends Error {
  constructor(
    readonly code: ArgusErrorCode | undefined,
    readonly status: number,
    message: string,
    readonly detail?: string,
    readonly params?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ArgusError';
  }

  toBody(): ApiErrorBody {
    return {
      error: this.message,
      ...(this.code ? { code: this.code } : {}),
      // Detail that only repeats the headline adds nothing behind a disclosure.
      ...(this.detail && this.detail !== this.message ? { detail: this.detail } : {}),
      ...(this.params && Object.keys(this.params).length ? { params: this.params } : {}),
    };
  }
}

export interface ClassifyHint {
  /** The binary the failing call ran ('git', 'gh', 'ngrok', 'rg', or an agent command). */
  tool?: string;
  /** Agent id when `tool` is an agent CLI; with `installUrl`, passed on in params. */
  agent?: string;
  installUrl?: string;
  /** The route's status for failures that match no class (default 500). */
  status?: number;
}

interface RawError {
  message?: unknown;
  code?: unknown;
  syscall?: unknown;
  path?: unknown;
  stderr?: unknown;
  killed?: unknown;
  signal?: unknown;
  /** Set by GitService on its rejections. */
  tool?: unknown;
  /** Set by GitService: Node reported a missing cwd as a spawn ENOENT. */
  cwdMissing?: unknown;
}

const GH_AUTH_TEXT = /gh auth login|not logged in|authentication required/i;

/** Why `gh` can't be used at all: missing binary, or not logged in. null when
 *  it is some other failure ("no pull requests found", a network blip). */
export function ghUnavailableCode(err: unknown): 'GH_NOT_INSTALLED' | 'GH_NOT_AUTHENTICATED' | null {
  const e = (err ?? {}) as RawError;
  if (e.code === 'ENOENT' || e.code === 'EACCES') return 'GH_NOT_INSTALLED';
  // gh exits 4 when authentication is required.
  if (e.code === 4) return 'GH_NOT_AUTHENTICATED';
  const stderr = typeof e.stderr === 'string' ? e.stderr : '';
  return GH_AUTH_TEXT.test(stderr) ? 'GH_NOT_AUTHENTICATED' : null;
}

/** The well-known tools by binary name. Anything else on a spawn ENOENT is
 *  an agent CLI when the hint says so. */
const TOOL_NOT_INSTALLED: Record<string, { code: ArgusErrorCode; message: string }> = {
  git: { code: 'GIT_NOT_INSTALLED', message: 'git is not installed' },
  gh: { code: 'GH_NOT_INSTALLED', message: 'GitHub CLI (gh) is not installed' },
  ngrok: { code: 'NGROK_NOT_INSTALLED', message: 'ngrok is not installed' },
  rg: { code: 'RIPGREP_UNAVAILABLE', message: 'ripgrep is not available' },
  ripgrep: { code: 'RIPGREP_UNAVAILABLE', message: 'ripgrep is not available' },
};

function toolFromSpawn(e: RawError): string | undefined {
  const p = typeof e.path === 'string' && e.path ? e.path : undefined;
  if (p) return path.basename(p);
  const syscall = typeof e.syscall === 'string' ? e.syscall : '';
  const word = syscall.replace(/^spawn\s*/, '').trim();
  return word ? path.basename(word) : undefined;
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const m = (err as RawError | null)?.message;
  if (typeof m === 'string') return m;
  return typeof err === 'string' ? err : 'Unknown error';
}

/**
 * Map a raw failure (Node errno, execFile rejection, GitService's
 * `{ message, stderr }`) to an ArgusError. Pure: no I/O, no spawning, so it
 * is unit-tested with synthetic error objects.
 *
 * A tool code needs a spawn syscall: an ENOENT on a *path* is
 * FOLDER_NOT_FOUND, never "git is not installed". The raw text is always
 * kept as `detail`.
 */
export function classifyError(err: unknown, hint: ClassifyHint = {}): ArgusError {
  if (err instanceof ArgusError) return err;
  const e = (err ?? {}) as RawError;
  const message = rawMessage(err);
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  const detail = stderr || message;
  const syscall = typeof e.syscall === 'string' ? e.syscall : '';
  const isSpawn = syscall.startsWith('spawn');
  if (!hint.tool && typeof e.tool === 'string') hint = { ...hint, tool: e.tool };

  if (isSpawn && e.code === 'ENOENT' && e.cwdMissing === true) {
    return new ArgusError('FOLDER_NOT_FOUND', 404, 'No such file or folder', detail);
  }

  if (isSpawn && (e.code === 'ENOENT' || e.code === 'EACCES')) {
    const fromPath = toolFromSpawn(e);
    const tool = (fromPath && TOOL_NOT_INSTALLED[fromPath] ? fromPath : undefined) ?? hint.tool ?? fromPath;
    const known = tool ? TOOL_NOT_INSTALLED[tool] : undefined;
    if (known) return new ArgusError(known.code, 503, known.message, detail, { tool: tool! });
    if (hint.agent) {
      const name = tool ?? hint.agent;
      return new ArgusError('AGENT_NOT_INSTALLED', 503, `${name} is not installed`, detail, {
        tool: name,
        agent: hint.agent,
        ...(hint.installUrl ? { installUrl: hint.installUrl } : {}),
      });
    }
  }

  const tool = hint.tool ?? (isSpawn ? toolFromSpawn(e) : undefined);

  if (e.killed === true && e.signal === 'SIGTERM') {
    const code: ArgusErrorCode = tool === 'gh' ? 'GH_TIMEOUT' : tool === 'ngrok' ? 'NGROK_TIMEOUT' : 'TIMEOUT';
    return new ArgusError(code, 504, `${tool ?? 'The operation'} timed out`, detail, tool ? { tool } : undefined);
  }

  if (tool === 'gh' || /gh auth login/i.test(stderr)) {
    const gh = ghUnavailableCode(err);
    if (gh === 'GH_NOT_AUTHENTICATED') return new ArgusError(gh, 503, 'GitHub CLI (gh) is not logged in', detail, { tool: 'gh' });
  }

  if (/not a git repository/i.test(stderr) || /not a git repository/i.test(message)) {
    return new ArgusError('NOT_A_GIT_REPO', 409, 'Not a git repository', detail);
  }

  if (!isSpawn && (e.code === 'EACCES' || e.code === 'EPERM')) {
    return new ArgusError('PERMISSION_DENIED', 403, 'Permission denied', detail, typeof e.path === 'string' ? { path: e.path } : undefined);
  }
  if (!isSpawn && e.code === 'ENOENT') {
    return new ArgusError('FOLDER_NOT_FOUND', 404, 'No such file or folder', detail, typeof e.path === 'string' ? { path: e.path } : undefined);
  }

  const status = hint.status ?? 500;
  const code: ArgusErrorCode | undefined = tool === 'git' ? 'GIT_FAILED' : status >= 500 ? 'INTERNAL' : undefined;
  return new ArgusError(code, status, message, detail);
}

/**
 * Answer a failed request: classify `err` and send `{ error, code?, detail?,
 * params? }` (plus `extra`, e.g. `{ success: false }` for routes whose body
 * shape carries it). Use instead of `res.status(500).json({ error: err.message })`.
 */
export function sendError(res: Response, err: unknown, hint?: ClassifyHint, extra?: Record<string, unknown>): void {
  if (res.headersSent) return;
  const e = classifyError(err, hint);
  res.status(e.status).json({ ...extra, ...e.toBody() });
}
