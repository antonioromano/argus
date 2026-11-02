// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Motion lives on the tokens in tokens.css: one easing (--ease), three
// durations (--dur-fast/base/slow), plus named signature motion
// (--motion-*, --ease-sidebar-*, --ease-tile-*). A raw duration or curve
// anywhere else escapes the reduced-motion overrides and drifts from the
// scale. Grep, not render — cheap and exhaustive.

const SRC = fileURLToPath(new URL('..', import.meta.url));
const TOKENS = 'tokens/tokens.css';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Source with comments blanked out (line numbers kept). */
function stripComments(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`\w])\/\/[^\n]*/g, (m, pre: string) => pre + blank(m.slice(pre.length)));
}

const files = sourceFiles(SRC)
  .map((path) => ({ rel: relative(SRC, path), src: stripComments(readFileSync(path, 'utf8')) }))
  .filter((f) => f.rel !== TOKENS);

function offenders(re: RegExp, skip?: RegExp): string[] {
  const out: string[] = [];
  for (const { rel, src } of files) {
    src.split('\n').forEach((line, i) => {
      if (re.test(line) && !skip?.test(line)) out.push(`${rel}:${i + 1} ${line.trim().slice(0, 100)}`);
    });
  }
  return out;
}

describe('motion tokens', () => {
  it('defines no cubic-bezier() outside tokens.css', () => {
    expect(offenders(/cubic-bezier\(/), 'name the curve in tokens.css and use var(--ease…)').toEqual([]);
  });

  it('writes no raw millisecond duration outside tokens.css', () => {
    expect(offenders(/\b\d{2,4}ms\b/), "use var(--dur-fast|base|slow) or a --motion-* token").toEqual([]);
  });

  it('writes no sub-second duration in seconds (0.2s) outside tokens.css', () => {
    // Infinite loops (spinners, crawls) set a period, not a transition: exempt.
    expect(offenders(/(^|[\s(,])0?\.\d+s\b/, /\binfinite\b/), 'use var(--dur-fast|base|slow)').toEqual([]);
  });

  it('uses --ease, never the removed std/out/in aliases', () => {
    expect(offenders(/var\(--ease-(std|out|in)\)/), 'replace var(--ease-std|out|in) with var(--ease)').toEqual([]);
  });
});
