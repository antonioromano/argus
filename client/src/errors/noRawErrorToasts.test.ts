// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raw-error toast guard (plan 2026-10-29-003, Unit 8). A failure is toasted
// through toastError(err, '<what failed>'), which maps typed codes to a cause
// and a fix; `pushToast(err.message, …)` puts "spawn git ENOENT" in front of
// the user. A grep, deliberately narrow: the broader lint guard is plan 005's.

const CLIENT_SRC = fileURLToPath(new URL('..', import.meta.url));

/** Files whose `.message` in a pushToast is not an error's. */
const ALLOWLIST = new Set<string>([
  // Electron main's toast payload ({ message, tone }), already user copy.
  'app/ui/LaunchCardStack.tsx',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

const RAW_ERROR_TOAST = /pushToast\([^)]*\.message/;

describe('error toasts', () => {
  it('never toast a raw error message (use toastError)', () => {
    const hits: string[] = [];
    for (const path of sourceFiles(CLIENT_SRC)) {
      const rel = relative(CLIENT_SRC, path);
      if (ALLOWLIST.has(rel)) continue;
      readFileSync(path, 'utf8').split('\n').forEach((text, i) => {
        if (RAW_ERROR_TOAST.test(text)) hits.push(`${rel}:${i + 1}: ${text.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('catches the pattern it is meant to', () => {
    expect(RAW_ERROR_TOAST.test("pushToast(err instanceof Error ? err.message : 'x', 'danger');")).toBe(true);
    expect(RAW_ERROR_TOAST.test("toastError(err, 'Couldn’t save');")).toBe(false);
  });
});
