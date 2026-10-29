import type { AppConfig, AppEnvironment } from '@argus/shared';

/**
 * The app-level diagnostics block behind Help → Copy Diagnostics and Report an
 * Issue (plan 002). Pure: main gathers the inputs (its own runtime facts, the
 * server's via collectServerFacts, the log tails) and this turns them into
 * paste-ready Markdown plus a short summary for the issue URL.
 *
 * Nothing personal leaves the machine: no session names, folder paths, agent
 * flag values, custom agent commands, ngrok URL, tokens or password hash.
 * Sessions are counted, never listed; config goes through CONFIG_DIAG_POLICY;
 * log lines go through redactLine.
 */

/** How one config key appears in the diagnostics. */
export type DiagPolicy =
  | 'include'  // verbatim (bools, enums, numbers, ids)
  | 'count'    // array length, or total entries across an object of arrays
  | 'presence' // '<set>' or absent: user text whose content is nobody's business
  | 'agent'    // a built-in agent id verbatim, anything else 'custom'
  | 'omit';

// A Record over keyof AppConfig: a new config key without a policy here fails
// the type-check, so nothing new reaches a bug report unclassified.
export const CONFIG_DIAG_POLICY: Record<keyof AppConfig, DiagPolicy> = {
  defaultAgent: 'agent',
  // Commands, install commands and prompt flags can embed tokens or paths.
  customAgents: 'count',
  // Flag values can carry `--api-key …`.
  agentFlags: 'count',
  notificationsEnabled: 'include',
  notifyOnWaiting: 'include',
  notifyOnDone: 'include',
  notifyOnPrChecks: 'include',
  notificationSound: 'include',
  showClock: 'include',
  clockShowSeconds: 'include',
  showStatusBar: 'include',
  restoreLayoutOnLaunch: 'include',
  othersFolderName: 'presence',
  preventSleepWhileRunning: 'include',
  confirmCloseShell: 'include',
  exitSessionsOnQuit: 'include',
  confirmExitOnQuit: 'include',
  keyboardShortcuts: 'include',
  uiFontSize: 'include',
  codeFontSize: 'include',
  mosaicWaitingStyle: 'include',
  mosaicOrientation: 'include',
  density: 'include',
  debugToolsEnabled: 'include',
  ptyBackend: 'include',
  tileQuickAction: 'include',
  tileRunningIndicator: 'include',
  quickActionPromptedAt: 'include',
  introSeen: 'include',
  defaultTerminalEngine: 'include',
  defaultRunMode: 'include',
  confirmQuitDirectSessions: 'include',
  // Personal paths.
  launchFolderRoots: 'count',
  showUsageMeter: 'include',
  usageMeterParts: 'include',
  usageWarnContext: 'include',
  usageWarnPlan: 'include',
  showPrStatus: 'include',
  inspectorSide: 'include',
  inspectorVisible: 'include',
  inspectorWidth: 'include',
  inspectorCollapsed: 'include',
  autoApprovalEnabled: 'include',
  claudeRenderer: 'include',
  defaultSessionView: 'include',
  betaActivityTimeline: 'include',
  betaWorktreeLifecycle: 'include',
  betaSessionTemplates: 'include',
  betaHandoff: 'include',
  betaSessionChains: 'include',
  showTips: 'include',
  // Tip ids, timestamps and checklist step ids: no user content.
  discovery: 'include',
};

/** Belt and braces for future keys: a secret-sounding name is dropped whatever its policy says. */
const SECRETISH_KEY = /pass|secret|token|auth|cred|key$/i;
/** Keys the guard would catch that are known to be safe. */
const SECRETISH_ALLOWED: ReadonlySet<string> = new Set(['keyboardShortcuts']);

const BUILTIN_AGENTS: ReadonlySet<string> = new Set(['claude', 'gemini', 'codex', 'shell']);

/** A built-in agent id as is; a custom agent's id is user text, so just 'custom'. */
export function agentLabel(id: string | undefined): string {
  if (!id) return 'none';
  return BUILTIN_AGENTS.has(id) ? id : 'custom';
}

function countOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') {
    return Object.values(v).reduce<number>((n, x) => n + (Array.isArray(x) ? x.length : 1), 0);
  }
  return 0;
}

/** The config as it may appear in a bug report. Unknown keys are dropped. */
export function redactConfig(cfg: Partial<AppConfig> | Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const policies = CONFIG_DIAG_POLICY as Record<string, DiagPolicy | undefined>;
  for (const [key, value] of Object.entries(cfg)) {
    const policy = policies[key] ?? 'omit';
    if (policy === 'omit' || value === undefined) continue;
    if (SECRETISH_KEY.test(key) && !SECRETISH_ALLOWED.has(key)) continue;
    if (policy === 'include') out[key] = value;
    else if (policy === 'count') out[key] = `${countOf(value)} entries`;
    else if (policy === 'presence') out[key] = value === '' || value === null ? '<empty>' : '<set>';
    else out[key] = agentLabel(typeof value === 'string' ? value : undefined);
  }
  return out;
}

const MAX_LINE = 500;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One log line made safe to paste publicly: paths under the home directory
 * (any user's) and external volumes become `<path>`, credentials and ngrok
 * URLs `<redacted>`, long hex runs (tokens, hashes) `<hex>`. Then truncated.
 */
export function redactLine(line: string, home: string): string {
  let s = line;
  if (home && home !== '/') s = s.replace(new RegExp(`${escapeRegExp(home)}(?:/[^\\s'"\`:,;)\\]]*)?`, 'g'), '<path>');
  s = s
    .replace(/(?:\/Users\/|\/Volumes\/|~\/)[^\s'"`:,;)\]]*/g, '<path>')
    .replace(/https?:\/\/[^\s'"`]*ngrok[^\s'"`]*/gi, '<redacted>')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/\bauthtoken\s+\S+/gi, 'authtoken <redacted>')
    // A CLI flag naming a secret: `--api-key sk-…`, `--token=…`.
    .replace(/(--?[\w-]*(?:key|token|secret|password)[\w-]*)(=|\s+)[^\s"',;&]+/gi, '$1$2<redacted>')
    .replace(/\b(token|secret|password|passwd|api[-_]?key)(["']?\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1$2<redacted>')
    .replace(/\b[0-9a-f]{32,}\b/gi, '<hex>');
  return s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s;
}

export interface ServerFacts {
  backend: {
    configured: 'auto' | 'tmux';
    active: 'daemon' | 'tmux' | 'direct';
    /** The socket's file name only (argusd-argus.sock), never its directory. */
    socket: string | null;
    /** null when the active backend is not the daemon. */
    daemonConnected: boolean | null;
    duplicateDaemons: number;
  };
  sessions: {
    total: number;
    byStatus: Record<string, number>;
    byAgent: Record<string, number>;
    byRunMode: Record<string, number>;
    byEngine: Record<string, number>;
  };
  windows: number;
  remote: {
    exposed: boolean;
    authEnabled: boolean;
    ngrokInstalled: boolean;
    ngrokTunnel: string;
  };
  betaFlags: string[];
  uptimeSec: number;
  /** Already passed through redactConfig. */
  config: Record<string, unknown>;
}

export interface DiagnosticsInput {
  environment: AppEnvironment;
  server: ServerFacts;
  logs: { recent: string[]; update: string[] };
  /** For path redaction; os.homedir() in production. */
  home: string;
  /** ISO timestamp the block was generated. */
  generatedAt: string;
}

export interface AppDiagnostics {
  markdown: string;
  /** A few lines for the issue URL (kept well under GitHub's URL limit). */
  summary: string;
}

const SUMMARY_MAX = 1500;

function tally(counts: Record<string, number>): string {
  const parts = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`);
  return parts.length ? parts.join(', ') : 'none';
}

function buildLabel(env: AppEnvironment): string {
  if (!env.build) return env.packaged ? 'unknown' : 'dev';
  return `${env.build.sha}${env.build.dirty ? '-dirty' : ''}${env.build.builtAt ? ` (${env.build.builtAt})` : ''}`;
}

function backendLabel(b: ServerFacts['backend']): string {
  const conn = b.daemonConnected === null ? '' : b.daemonConnected ? ', connected' : ', disconnected';
  return `${b.active}${conn} (configured: ${b.configured})`;
}

function fenced(lines: string[]): string {
  // A line holding ``` would close the fence early; four backticks are safe for any of ours.
  return ['````', ...lines, '````'].join('\n');
}

export function buildAppDiagnostics(input: DiagnosticsInput): AppDiagnostics {
  const { environment: env, server: s, logs, home } = input;
  const redact = (l: string) => redactLine(l, home);
  const md: string[] = [];

  md.push('## Argus diagnostics', '', `Generated ${input.generatedAt}. Counts only: no session names, paths or secrets.`, '');

  md.push('### Environment', '');
  md.push(`- Argus: ${env.appVersion} (${env.packaged ? 'packaged' : 'dev'})`);
  md.push(`- Build: ${buildLabel(env)}`);
  md.push(`- macOS: ${env.macos} (${env.arch})`);
  md.push(`- Electron ${env.electron} · Chromium ${env.chrome} · Node ${env.node}`);
  md.push(`- Server uptime: ${s.uptimeSec}s`, '');

  md.push('### Backend', '');
  md.push(`- Pty backend: ${backendLabel(s.backend)}`);
  md.push(`- Socket: ${s.backend.socket ?? 'n/a'}`);
  md.push(`- Duplicate daemons: ${s.backend.duplicateDaemons}`, '');

  md.push('### Sessions', '');
  md.push(`- Total: ${s.sessions.total}`);
  md.push(`- By status: ${tally(s.sessions.byStatus)}`);
  md.push(`- By agent: ${tally(s.sessions.byAgent)}`);
  md.push(`- By run mode: ${tally(s.sessions.byRunMode)}`);
  md.push(`- By engine: ${tally(s.sessions.byEngine)}`);
  md.push(`- Windows: ${s.windows}`, '');

  md.push('### Remote', '');
  md.push(`- Exposed: ${s.remote.exposed ? 'yes' : 'no'} · password set: ${s.remote.authEnabled ? 'yes' : 'no'}`);
  md.push(`- ngrok: ${s.remote.ngrokInstalled ? 'installed' : 'not installed'}, tunnel ${s.remote.ngrokTunnel}`, '');

  md.push('### Config', '');
  md.push(`- Beta flags on: ${s.betaFlags.length ? s.betaFlags.join(', ') : 'none'}`, '');
  md.push(fenced(JSON.stringify(s.config, null, 2).split('\n')), '');

  md.push('### Recent log (warnings and errors)', '');
  md.push(logs.recent.length ? fenced(logs.recent.map(redact)) : '_empty_', '');

  md.push('### update.log', '');
  md.push(logs.update.length ? fenced(logs.update.map(redact)) : '_empty_');

  const summaryLines = [
    `- Argus ${env.appVersion} (${env.packaged ? 'packaged' : 'dev'}), build ${buildLabel(env)}`,
    `- macOS ${env.macos} (${env.arch}), Electron ${env.electron}`,
    `- Backend: ${backendLabel(s.backend)}, duplicate daemons ${s.backend.duplicateDaemons}`,
    `- Sessions: ${s.sessions.total} (${tally(s.sessions.byStatus)})`,
    `- Agents: ${tally(s.sessions.byAgent)}`,
    `- Windows: ${s.windows} · exposed: ${s.remote.exposed ? 'yes' : 'no'}`,
    `- Beta flags: ${s.betaFlags.length ? s.betaFlags.join(', ') : 'none'}`,
  ];
  let summary = summaryLines.join('\n');
  // Bytes, not characters: the summary ends up percent-encoded in a URL.
  if (Buffer.byteLength(summary) > SUMMARY_MAX) {
    while (Buffer.byteLength(summary) > SUMMARY_MAX - 3) summary = summary.slice(0, -16);
    summary += '…';
  }

  return { markdown: md.join('\n'), summary };
}
