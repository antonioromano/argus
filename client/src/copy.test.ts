// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionInfo } from '@argus/shared';
import { buildSessionMenuItems, type SessionMenuActions } from './app/ui/sessionMenu.js';
import { SETTINGS } from './app/overlays/settings/catalog.js';
import { PANES } from './app/overlays/settings/registry.js';

// The writing guide (docs/design/writing-guide.md) as checks: sentence case in
// Settings, Title Case in the session menu, a real ellipsis, one noun for a
// session, and no implementation jargon in default-visible Settings labels.

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Proper nouns and named surfaces that keep their capital mid-sentence. */
const PROPER = new Set([
  'Argus', 'Claude', 'Codex', 'Gemini', 'GitHub', 'Mac', 'macOS', 'ngrok', 'tmux',
  'Focus', 'Mosaic', 'Session', 'Inspector', 'Waiting', 'Inbox', 'Find', 'Jump',
  'Universal', 'Advanced', 'Native', 'Chat',
]);

/** Words after the first that break sentence case (acronyms and symbols pass). */
function titleCasedWords(text: string): string[] {
  return text
    .replace(/[“”"'()…:·,.?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(1)
    .filter((w) => /^[A-Z][a-z]/.test(w) && !PROPER.has(w));
}

const session: SessionInfo = {
  id: 's1', name: 'argus', folderPath: '/tmp/argus', status: 'idle',
  createdAt: '2026-01-01T00:00:00.000Z', agentType: 'claude', flags: [],
};

/** Every optional action wired and every gate open, so every entry renders. */
function allActions(): SessionMenuActions {
  const yes = () => true;
  return {
    onRename: vi.fn(), onOpen: vi.fn(), onKill: vi.fn(), onRestart: vi.fn(),
    onFocusDiff: vi.fn(), onFocusExplorer: vi.fn(), onFocusTerminal: vi.fn(),
    onEditIdentity: vi.fn(), onToggleMinimize: vi.fn(), onMoveToNewWindow: vi.fn(),
    onMergeAllHere: vi.fn(), canMergeAllHere: true, onClone: vi.fn(),
    onMerge: vi.fn(), canMerge: yes, onHandoff: vi.fn(), onChain: vi.fn(),
    onFinish: vi.fn(), canFinish: yes, onMarkDone: vi.fn(), canMarkDone: yes,
    onResume: vi.fn(), canResume: yes, showDiagnostics: true, onDumpDiagnostics: vi.fn(),
    onHideBetaPromos: vi.fn(),
  } as SessionMenuActions;
}

describe('copy', () => {
  it('uses the ellipsis character, never three dots, in JSX strings', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const src = readFileSync(path, 'utf8');
      src.split('\n').forEach((line, i) => {
        // String literals and JSX text only; spreads (`...x`) are code.
        if (/(['"`>])[^'"`<>{}]*\w\.\.\.(?=[\s'"`<]|$)/.test(line)) offenders.push(`${relative(SRC, path)}:${i + 1}`);
      });
    }
    expect(offenders, 'use … (U+2026)').toEqual([]);
  });

  it('writes session-menu items in Title Case', () => {
    const SMALL = new Set(['a', 'an', 'and', 'as', 'the', 'for', 'in', 'on', 'of', 'to', 'at', 'by', 'or', '&']);
    const labels = buildSessionMenuItems(session, allActions())
      .flatMap((e) => ('label' in e && typeof e.label === 'string' ? [e.label] : []));
    expect(labels.length).toBeGreaterThan(10);
    const offenders = labels.filter((label) =>
      label.replace(/[()…]/g, '').split(/\s+/).filter(Boolean).some((w, i) => !(i > 0 && SMALL.has(w)) && !/^[A-Z0-9&]/.test(w)));
    expect(offenders).toEqual([]);
  });

  it('writes Settings labels, sections and pane names in sentence case', () => {
    const offenders: string[] = [];
    for (const s of SETTINGS) {
      for (const text of [s.label, s.section]) {
        const bad = titleCasedWords(text);
        if (bad.length) offenders.push(`${s.id}: "${text}" (${bad.join(', ')})`);
      }
    }
    for (const p of PANES) {
      const bad = titleCasedWords(p.label);
      if (bad.length) offenders.push(`pane ${p.id}: "${p.label}"`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps implementation jargon out of Settings labels and section titles', () => {
    const JARGON = /\b(argusd|daemon|pty|orphan|janitor|backend)\b/i;
    const offenders = SETTINGS.flatMap((s) => [s.label, s.section].filter((t) => JARGON.test(t)).map((t) => `${s.id}: ${t}`));
    expect(offenders).toEqual([]);
  });

  it('calls a session a session in Settings, not a shell', () => {
    // The companion shell docked in Focus is a real shell process.
    const offenders = SETTINGS.filter((s) => s.id !== 'shortcut:open-shell').flatMap((s) => {
      const hint = typeof s.hint === 'string' ? s.hint : '';
      return [s.label, s.section, hint].filter((t) => /\bshells?\b/i.test(t)).map((t) => `${s.id}: ${t}`);
    });
    expect(offenders, 'docs/design/writing-guide.md §5').toEqual([]);
  });
});
