import type { ArgusErrorCode } from '@argus/shared';
import type { ErrorAction } from './errorActions.js';

/** Code-specific values from the server (`ApiErrorBody.params`). */
export type ErrorParams = Readonly<Record<string, string | undefined>>;

type Text = string | ((p: ErrorParams) => string);

export interface CopyEntry {
  /** Headline: what failed, in the user's words. */
  title: Text;
  /** One sentence: why, and what to do about it. */
  cause: Text;
  /** Fix-it actions, primary first. Retry is appended for retryable codes. */
  actions?: (p: ErrorParams) => ErrorAction[];
  /** Whether repeating the same call can succeed once the cause is fixed. */
  retryable: boolean;
}

export const resolveText = (t: Text, p: ErrorParams): string => (typeof t === 'function' ? t(p) : t);

const tool = (p: ErrorParams, fallback: string) => p.tool || p.agent || fallback;

/**
 * Every ArgusErrorCode → its copy. `satisfies` makes a missing code a build
 * error (R4). Copy rules: noun "session"; cause + next action; installs are a
 * copyable `brew install …` (Argus ships as a Homebrew cask, so brew is there),
 * never run by Argus; raw tool output lives in Details, not here.
 */
export const ERROR_COPY = {
  SERVER_UNREACHABLE: {
    title: 'The Argus server isn’t responding',
    cause: 'It may still be starting, or it stopped. Argus reconnects when it comes back.',
    retryable: true,
  },
  AUTH_REQUIRED: {
    title: 'Sign-in required',
    cause: 'Your remote session expired. Enter the remote password again.',
    retryable: false,
  },
  SESSION_NOT_FOUND: {
    title: 'Session not found',
    cause: 'It was closed or removed. Pick another session.',
    retryable: false,
  },
  FOLDER_NOT_FOUND: {
    title: 'Folder not found',
    cause: (p) => `${p.path ? `${p.path} no longer exists` : 'The folder or file no longer exists'}. It may have been moved or deleted.`,
    retryable: true,
  },
  PERMISSION_DENIED: {
    title: 'Permission denied',
    cause: 'macOS refused access to this location. Check its permissions, or allow Argus in System Settings → Privacy & Security.',
    retryable: true,
  },
  GIT_NOT_INSTALLED: {
    title: 'git isn’t installed',
    cause: 'Argus needs git for diffs, branches and commits. Install it, then retry.',
    actions: () => [{ kind: 'copy-command', command: 'brew install git' }],
    retryable: true,
  },
  NOT_A_GIT_REPO: {
    title: 'Not a git repository',
    cause: 'This folder isn’t tracked by git, so there are no changes to show.',
    retryable: false,
  },
  GIT_FAILED: {
    title: 'git reported an error',
    cause: 'The git command failed. Its output is under Details.',
    retryable: true,
  },
  GH_NOT_INSTALLED: {
    title: 'GitHub CLI isn’t installed',
    cause: 'Argus reads pull requests through gh. Install it, sign in with gh auth login, then retry.',
    actions: () => [{ kind: 'copy-command', command: 'brew install gh' }],
    retryable: true,
  },
  GH_NOT_AUTHENTICATED: {
    title: 'GitHub CLI isn’t signed in',
    cause: 'Run gh auth login in a terminal, then retry.',
    actions: () => [{ kind: 'copy-command', command: 'gh auth login' }],
    retryable: true,
  },
  GH_TIMEOUT: {
    title: 'GitHub took too long',
    cause: 'gh didn’t answer in time. GitHub may be slow, or the network is down.',
    retryable: true,
  },
  AGENT_NOT_INSTALLED: {
    title: (p) => `${tool(p, 'The agent CLI')} isn’t installed`,
    cause: (p) => `Argus couldn’t find ${tool(p, 'the agent CLI')} on your PATH. Install it, or set its command in Settings → Agents.`,
    actions: (p) => [
      ...(p.installCommand ? [{ kind: 'copy-command' as const, command: p.installCommand }] : []),
      ...(p.installUrl ? [{ kind: 'open-url' as const, url: p.installUrl, label: 'Open install page' }] : []),
      { kind: 'open-settings', pane: 'agents' },
    ],
    retryable: true,
  },
  AGENT_UNKNOWN: {
    title: 'Unknown agent',
    cause: (p) => `${p.agent ? `“${p.agent}”` : 'This agent'} isn’t set up in Argus. Add it in Settings → Agents.`,
    actions: () => [{ kind: 'open-settings', pane: 'agents' }],
    retryable: false,
  },
  RIPGREP_UNAVAILABLE: {
    title: 'Search tool missing from this build',
    cause: 'ripgrep ships inside Argus, so this install is broken. Reinstall Argus.',
    actions: () => [{ kind: 'copy-command', command: 'brew reinstall --cask argus' }, { kind: 'report-issue' }],
    retryable: false,
  },
  NGROK_NOT_INSTALLED: {
    title: 'ngrok isn’t installed',
    cause: 'Remote access runs through ngrok. Install it, then retry.',
    actions: () => [{ kind: 'copy-command', command: 'brew install ngrok' }],
    retryable: true,
  },
  NGROK_AUTH_FAILED: {
    title: 'ngrok rejected its auth token',
    cause: 'Add your token with ngrok config add-authtoken, then retry.',
    actions: () => [
      { kind: 'open-url', url: 'https://dashboard.ngrok.com/get-started/your-authtoken', label: 'Get your ngrok token' },
      { kind: 'open-settings', pane: 'remote' },
    ],
    retryable: true,
  },
  NGROK_TIMEOUT: {
    title: 'ngrok didn’t connect',
    cause: 'The tunnel didn’t come up in time. Check your network, then retry.',
    retryable: true,
  },
  DAEMON_UNAVAILABLE: {
    title: 'The session host didn’t start',
    cause: 'argusd, which keeps sessions running, didn’t come up. Retry, or quit and reopen Argus.',
    actions: () => [{ kind: 'report-issue' }],
    retryable: true,
  },
  TIMEOUT: {
    title: 'That took too long',
    cause: (p) => `${p.tool ?? 'The operation'} didn’t finish in time. Retry, or check the folder isn’t on a slow drive.`,
    retryable: true,
  },
  INTERNAL: {
    title: 'Something went wrong',
    cause: 'Argus hit an unexpected error. What happened is under Details.',
    actions: () => [{ kind: 'report-issue' }],
    retryable: true,
  },
} satisfies Record<ArgusErrorCode, CopyEntry>;

/** Copy for errors without a code, by HTTP status (routes not migrated yet). */
export const STATUS_COPY: Readonly<Record<number, CopyEntry>> = {
  404: { title: 'Not found', cause: 'It may have been moved, closed or deleted.', retryable: false },
  409: { title: 'It changed in the meantime', cause: 'Something else changed it first. Refresh, then try again.', retryable: true },
  503: { title: 'Service unavailable', cause: 'A tool Argus needs isn’t available right now.', retryable: true },
  504: { title: 'That took too long', cause: 'It didn’t finish in time. Retry in a moment.', retryable: true },
};

export const GENERIC_COPY: CopyEntry = {
  title: 'Something went wrong',
  cause: 'Argus hit an unexpected error. What happened is under Details.',
  retryable: true,
};

export function isArgusErrorCode(code: unknown): code is ArgusErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_COPY, code);
}
