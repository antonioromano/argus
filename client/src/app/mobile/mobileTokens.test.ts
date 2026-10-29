// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Plan 009 M1: the phone uses the desktop type tokens. Until plan 005's lint
// guard covers inline font sizes, this keeps raw numbers out of the mobile UI.
describe('mobile type tokens', () => {
  it('no mobile component sets a numeric fontSize, except the iOS no-zoom field', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))) {
      readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/fontSize:\s*\d/.test(line) && !line.includes('avoids iOS input-zoom')) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
