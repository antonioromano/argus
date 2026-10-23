import { describe, it, expect } from 'vitest';
import { relativeTo } from './pathFormat.js';

describe('relativeTo', () => {
  it('strips the root and its separator', () => {
    expect(relativeTo('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(relativeTo('/repo/', '/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('leaves a sibling sharing the prefix untouched', () => {
    expect(relativeTo('/repo', '/repo2/x.ts')).toBe('/repo2/x.ts');
  });
});
