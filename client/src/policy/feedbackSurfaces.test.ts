// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Feedback-surface policy guard (docs/design/feedback-surfaces.md). Native
// dialogs are for app lifecycle and system failures only, and the browser's
// window.confirm / alert / prompt are never used (Electron doesn't even
// implement prompt). This is a grep over the source, not a render: cheap and
// exhaustive. If an ESLint `no-restricted-syntax` rule takes this over, delete
// this file in the same change.

const CLIENT_SRC = fileURLToPath(new URL('..', import.meta.url));
const ELECTRON_SRC = fileURLToPath(new URL('../../../electron/src', import.meta.url));

/**
 * Renderer files allowed to open a native dialog through a preload bridge.
 * Empty since plan 004 U9 moved the backend switch (V1) to an AlertSheet and
 * dropped the dialog:showMessageBox IPC; keep it empty.
 */
const NATIVE_DIALOG_ALLOWLIST = new Set<string>([]);

/** The only electron file allowed to call dialog.showMessageBox: quit, port conflict, update failure. */
const ELECTRON_DIALOG_FILES = new Set<string>(['main.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

/** Drops comments so prose like "Electron does not implement window.prompt()" doesn't trip the scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

interface Hit { file: string; line: number; text: string }

function scan(root: string, pattern: RegExp, skip: (rel: string) => boolean = () => false): Hit[] {
  const hits: Hit[] = [];
  for (const path of sourceFiles(root)) {
    const rel = relative(root, path);
    if (skip(rel)) continue;
    const lines = stripComments(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

const fmt = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

// `window.confirm(`, `globalThis.alert (`, or a bare `prompt(` call (not `.prompt(`, not `onConfirm(`).
const BROWSER_DIALOG = /(?:\b(?:window|globalThis|self)\s*\.\s*(?:confirm|alert|prompt)\s*\()|(?:(?<![\w$.])(?:confirm|alert|prompt)\()/;
const NATIVE_BRIDGE_CALL = /(?<!function\s)\bshowNativeMessageBox\s*\(/;
const ELECTRON_MESSAGE_BOX = /\bshowMessageBox(?:Sync)?\s*\(/;

describe('feedback-surface policy', () => {
  it('the renderer never calls window.confirm / alert / prompt', () => {
    const hits = scan(CLIENT_SRC, BROWSER_DIALOG);
    expect(hits, `Use an AlertSheet (irreversible) or an Undo toast (reversible) instead:\n${fmt(hits)}`).toEqual([]);
  });

  it('the renderer opens native dialogs only from allowlisted files', () => {
    const hits = scan(CLIENT_SRC, NATIVE_BRIDGE_CALL, (rel) => NATIVE_DIALOG_ALLOWLIST.has(rel));
    expect(hits, `Native dialogs are for app lifecycle / system failures only — use an AlertSheet:\n${fmt(hits)}`).toEqual([]);
  });

  it('every allowlisted file still calls the bridge (the allowlist only shrinks)', () => {
    const stale = [...NATIVE_DIALOG_ALLOWLIST].filter((rel) => {
      const path = join(CLIENT_SRC, rel);
      return !existsSync(path) || !NATIVE_BRIDGE_CALL.test(stripComments(readFileSync(path, 'utf8')));
    });
    expect(stale, 'Remove these from NATIVE_DIALOG_ALLOWLIST').toEqual([]);
  });

  it('electron calls dialog.showMessageBox only from main.ts', () => {
    const hits = scan(ELECTRON_SRC, ELECTRON_MESSAGE_BOX, (rel) => ELECTRON_DIALOG_FILES.has(rel));
    expect(hits, `Native dialogs belong in main.ts (quit, port conflict, update failure):\n${fmt(hits)}`).toEqual([]);
  });

  describe('the patterns themselves', () => {
    it.each([
      'if (window.confirm("Delete?")) go();',
      'globalThis.alert(msg);',
      'const name = prompt("Name");',
      'window . confirm ("x")',
    ])('flags %s', (line) => {
      expect(BROWSER_DIALOG.test(line)).toBe(true);
    });

    it.each([
      'onConfirm();',
      'props.confirm(x);',
      'placeholder="Initial prompt (optional)"',
      'const confirmCloseShell = true;',
      'setPrompt(value);',
    ])('ignores %s', (line) => {
      expect(BROWSER_DIALOG.test(line)).toBe(false);
    });

    it('ignores comments', () => {
      expect(BROWSER_DIALOG.test(stripComments('// Electron does not implement window.prompt().'))).toBe(false);
      expect(BROWSER_DIALOG.test(stripComments('/* a "confirm()" here */'))).toBe(false);
      expect(stripComments('const u = "https://example.com"; // tail')).toContain('https://example.com');
    });

    it('flags bridge calls but not the bridge definition', () => {
      expect(NATIVE_BRIDGE_CALL.test('const choice = await showNativeMessageBox({')).toBe(true);
      expect(NATIVE_BRIDGE_CALL.test('export async function showNativeMessageBox(opts) {')).toBe(false);
    });
  });
});
