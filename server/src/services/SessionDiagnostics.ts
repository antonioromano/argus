import fs from 'fs';
import path from 'path';
import type { SessionInfo, AgentSignal, AgentSignalState } from '@argus/shared';
import type { StateDetectorDiagnostics } from './StateDetector.js';

/** Subfolder of the Argus data dir (`~/.argus`) where dump files land. */
export const DIAGNOSTICS_DIRNAME = 'diagnostics';
/** Keep only the newest N dumps; older ones are pruned on each write. */
const MAX_FILES = 50;

export interface TmuxDiagnostics {
  tmuxName: string;
  paneDead: boolean;
  cursorX: number;
  cursorY: number;
  alternate: boolean;
  appMouse: boolean;
  sgr: boolean;
}

/**
 * Everything captured for one session, assembled by
 * `SessionManager.collectSessionDiagnostics`. Split into small structured
 * metadata (goes verbatim into the report's ```json block) and large text
 * blobs (`scrollback`, `rawTail`) that are rendered as fenced code instead.
 */
export interface SessionDiagnosticsPayload {
  session: SessionInfo;
  runtime: {
    persistent: boolean;
    tmuxName?: string;
    cols?: number;
    rows?: number;
    suppressDonePromotion: boolean;
    donePromotionPending: boolean;
    hasUserInputSinceIdle: boolean;
    outputBufferBytes: number;
    outputBufferCapBytes: number;
    connectedClients: number;
    /** Native-signal arbitration state (plan 2026-07-22-001); absent pre-feature. */
    native?: {
      state: AgentSignalState | null;
      lastSeenAt: number | null;
      ageMs: number | null;
      fresh: boolean;
      coverage: AgentSignalState[] | null;
      ring: AgentSignal[];
    };
  };
  detector: StateDetectorDiagnostics;
  tmux: TmuxDiagnostics | null;
  /** Full tmux scrollback capture; null for non-tmux sessions or capture failure. */
  scrollback: string | null;
  /** Last slice of the rolling output buffer (fallback view of recent bytes). */
  rawTail: string;
  app: {
    nodeEnv: string;
    port: string;
    tmuxSocket: string;
    pid: number;
    capturedAt: string;
  };
}

/** Slug a session name into a filesystem-safe basename fragment. */
function slug(name: string): string {
  const s = name
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return s || 'session';
}

/** Fence a text blob, guarding against an embedded ``` closing the block early. */
function fence(body: string, lang = ''): string {
  const safe = body.replace(/```/g, '`​``');
  return `\`\`\`${lang}\n${safe}\n\`\`\``;
}

/**
 * Render a payload into a Markdown report (human + Claude readable) with an
 * embedded machine-readable JSON block. The JSON deliberately omits the large
 * `scrollback`/`rawTail` blobs — those are rendered as fenced code below so the
 * JSON stays small and parseable.
 */
export function buildReport(p: SessionDiagnosticsPayload): { markdown: string; json: string } {
  const { session, runtime, detector, tmux, app } = p;
  const jsonObj = { session, runtime, detector, tmux, app };
  const json = JSON.stringify(jsonObj, null, 2);

  const md: string[] = [];
  md.push(`# Argus session diagnostics — ${session.name}`);
  md.push('');
  md.push(`- **Captured:** ${app.capturedAt}`);
  md.push(`- **Session id:** \`${session.id}\``);
  md.push(`- **Agent:** ${session.agentType}${session.flags.length ? ` (${session.flags.join(' ')})` : ''}`);
  md.push(`- **Folder:** \`${session.folderPath}\``);
  md.push(`- **Reported status:** \`${session.status}\``);
  md.push(`- **Detector status:** \`${detector.currentStatus}\`` +
    (detector.pendingStatus ? ` → pending \`${detector.pendingStatus}\`` : '') +
    ` · classify=\`${detector.classified ?? 'null'}\``);
  md.push(`- **Persistent (tmux-backed):** ${runtime.persistent}`);
  md.push(`- **Connected clients:** ${runtime.connectedClients}`);
  md.push('');

  md.push('## Machine-readable snapshot');
  md.push('');
  md.push(fence(json, 'json'));
  md.push('');

  md.push('## StateDetector');
  md.push('');
  md.push(`- currentStatus: \`${detector.currentStatus}\` · pendingStatus: \`${detector.pendingStatus ?? 'null'}\``);
  md.push(`- classify(): \`${detector.classified ?? 'null'}\` · feedCount: ${detector.feedCount}`);
  md.push(`- recentCursorStyle: ${detector.recentCursorStyle} · cursor: (${detector.cursor.x}, ${detector.cursor.y})`);
  md.push(`- resizeAgeMs: ${detector.resizeAgeMs}`);
  md.push(`- lastReportedPrompt: ${detector.lastReportedPrompt ? `\`${detector.lastReportedPrompt}\`` : '—'}`);
  md.push(`- extractedPrompt: ${detector.extractedPrompt ? `\`${detector.extractedPrompt}\`` : '—'}`);
  md.push('');
  md.push('### Visible rows (classifier scan window)');
  md.push('');
  md.push(fence(detector.visibleRows.join('\n') || '(empty)'));
  md.push('');

  md.push('## Status machine');
  md.push('');
  md.push(`- suppressDonePromotion: ${runtime.suppressDonePromotion}`);
  md.push(`- donePromotionPending: ${runtime.donePromotionPending}`);
  md.push(`- hasUserInputSinceIdle: ${runtime.hasUserInputSinceIdle}`);
  md.push(`- outputBuffer: ${runtime.outputBufferBytes} / ${runtime.outputBufferCapBytes} bytes`);
  md.push(`- last client grid: ${runtime.cols ?? '?'}×${runtime.rows ?? '?'}`);
  md.push('');

  md.push('## tmux / pty');
  md.push('');
  if (tmux) {
    md.push(`- tmux session: \`${tmux.tmuxName}\` · paneDead: ${tmux.paneDead}`);
    md.push(`- cursor: (${tmux.cursorX}, ${tmux.cursorY}) · alternate: ${tmux.alternate}`);
    md.push(`- appMouse: ${tmux.appMouse} · sgr: ${tmux.sgr}`);
  } else {
    md.push('- Non-tmux session (no tmux diagnostics available).');
  }
  md.push('');

  md.push('## Full scrollback (tmux capture-pane)');
  md.push('');
  md.push(p.scrollback !== null ? fence(p.scrollback || '(empty)') : '_Unavailable (non-tmux or capture failed)._');
  md.push('');

  md.push('## Raw output tail');
  md.push('');
  md.push(fence(p.rawTail || '(empty)'));
  md.push('');

  return { markdown: md.join('\n'), json };
}

/**
 * Write a report to `<dataDir>/diagnostics/<slug>-<id8>-<ts>.md`, creating the
 * directory and pruning to the newest MAX_FILES. Returns the absolute path.
 */
export async function writeReport(
  dataDir: string,
  markdown: string,
  session: SessionInfo,
  capturedAt: string,
): Promise<string> {
  const dir = path.join(dataDir, DIAGNOSTICS_DIRNAME);
  await fs.promises.mkdir(dir, { recursive: true });
  const ts = capturedAt.replace(/[:.]/g, '-');
  const file = path.join(dir, `${slug(session.name)}-${session.id.slice(0, 8)}-${ts}.md`);
  await fs.promises.writeFile(file, markdown, 'utf8');
  await pruneOldReports(dir);
  return file;
}

/** Delete all but the newest MAX_FILES `.md` dumps (best-effort). */
async function pruneOldReports(dir: string): Promise<void> {
  try {
    const entries = await fs.promises.readdir(dir);
    const files = entries.filter((f) => f.endsWith('.md'));
    if (files.length <= MAX_FILES) return;
    const withTimes = await Promise.all(
      files.map(async (f) => {
        const full = path.join(dir, f);
        const stat = await fs.promises.stat(full);
        return { full, mtime: stat.mtimeMs };
      }),
    );
    withTimes.sort((a, b) => b.mtime - a.mtime); // newest first
    await Promise.all(withTimes.slice(MAX_FILES).map((e) => fs.promises.unlink(e.full).catch(() => {})));
  } catch {
    // best-effort — never let pruning break a dump
  }
}
