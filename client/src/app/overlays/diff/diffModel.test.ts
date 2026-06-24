import { describe, it, expect } from 'vitest';
import {
  modelsFromRaw,
  diffStats,
  shouldAutoCollapse,
  estimateBodyHeight,
  AUTO_COLLAPSE_CHUNKS,
} from './diffModel.js';

const SIMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 keep
-old line
+new line
 tail
`;

const TWO_FILES = `diff --git a/one.ts b/one.ts
index 111..222 100644
--- a/one.ts
+++ b/one.ts
@@ -1,1 +1,2 @@
 a
+b
diff --git a/two.ts b/two.ts
index 333..444 100644
--- a/two.ts
+++ b/two.ts
@@ -1,2 +1,1 @@
 x
-y
`;

const RENAME = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 111..222 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,1 +1,1 @@
-foo
+bar
`;

describe('modelsFromRaw', () => {
  it('returns an empty array for empty/whitespace input', () => {
    expect(modelsFromRaw('', 'unstaged')).toEqual([]);
    expect(modelsFromRaw('   \n', 'unstaged')).toEqual([]);
  });

  it('builds one model per file with id, counts and parsed object', () => {
    const models = modelsFromRaw(SIMPLE, 'unstaged');
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m.path).toBe('src/a.ts');
    expect(m.id).toBe('unstaged::src/a.ts');
    expect(m.source).toBe('unstaged');
    expect(m.add).toBe(1);
    expect(m.del).toBe(1);
    expect(m.parsed.chunks).toHaveLength(1);
  });

  it('splits a multi-file group into distinct models keyed by source', () => {
    const models = modelsFromRaw(TWO_FILES, 'staged');
    expect(models.map((m) => m.id)).toEqual(['staged::one.ts', 'staged::two.ts']);
  });

  it('resolves rename origin into fromPath only when it differs', () => {
    const [m] = modelsFromRaw(RENAME, 'unstaged');
    expect(m.path).toBe('new/name.ts');
    expect(m.fromPath).toBe('old/name.ts');

    const [s] = modelsFromRaw(SIMPLE, 'unstaged');
    expect(s.fromPath).toBeUndefined();
  });
});

describe('diffStats / shouldAutoCollapse / estimateBodyHeight', () => {
  it('counts change rows and chunks', () => {
    const [m] = modelsFromRaw(SIMPLE, 'unstaged');
    const stats = diffStats(m.parsed);
    expect(stats.chunks).toBe(1);
    // keep + old + new + tail = 4 change rows
    expect(stats.lines).toBe(4);
  });

  it('does not auto-collapse a small diff', () => {
    const [m] = modelsFromRaw(SIMPLE, 'unstaged');
    expect(shouldAutoCollapse(m.parsed)).toBe(false);
  });

  it('auto-collapses a file with many chunks', () => {
    const [m] = modelsFromRaw(SIMPLE, 'unstaged');
    const many = { ...m.parsed, chunks: Array.from({ length: AUTO_COLLAPSE_CHUNKS + 1 }, () => m.parsed.chunks[0]) };
    expect(shouldAutoCollapse(many)).toBe(true);
  });

  it('estimates a positive body height proportional to content', () => {
    const [m] = modelsFromRaw(SIMPLE, 'unstaged');
    expect(estimateBodyHeight(m.parsed)).toBeGreaterThan(0);
  });
});
