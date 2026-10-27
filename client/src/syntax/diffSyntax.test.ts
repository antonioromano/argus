// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import parseDiff from 'parse-diff';
import { diffSyntax, diffPath } from './diffSyntax.js';
import { loadLang, type SynToken } from './highlighter.js';

const RAW = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const keep = 1;
-let old = "x"; // gone
+const next = 'y'; // here
 export {};
`;

const text = (line: SynToken[] | undefined) => (line ?? []).map((t) => t.text).join('');
const slots = (line: SynToken[] | undefined) =>
  Object.fromEntries((line ?? []).filter((t) => t.slot).map((t) => [t.text.trim(), t.slot]));

describe('diffSyntax', () => {
  beforeAll(async () => {
    expect(await loadLang('typescript')).toBe(true);
  });

  it('tokenizes each side and keys tokens by change', () => {
    const [file] = parseDiff(RAW);
    expect(diffPath(file)).toBe('src/a.ts');
    const syn = diffSyntax(file, 'typescript')!;
    const [ctx, del, add] = file.chunks[0].changes;
    expect(text(syn.get(ctx))).toBe('const keep = 1;');
    expect(text(syn.get(del))).toBe('let old = "x"; // gone');
    expect(text(syn.get(add))).toBe("const next = 'y'; // here");
    expect(slots(syn.get(ctx))).toMatchObject({ const: 'kw', '1': 'num' });
    expect(slots(syn.get(del))).toMatchObject({ let: 'kw', '"x"': 'str' });
    expect(slots(syn.get(add))).toMatchObject({ const: 'kw', "'y'": 'str' });
  });

  it('leaves comments and punctuation unpainted on changed rows only', () => {
    const [file] = parseDiff(RAW);
    const syn = diffSyntax(file, 'typescript')!;
    const [ctx, del, add] = file.chunks[0].changes;
    for (const c of [del, add]) {
      expect(syn.get(c)!.some((t) => t.slot === 'cm' || t.slot === 'pn')).toBe(false);
    }
    expect(syn.get(ctx)!.some((t) => t.slot === 'pn')).toBe(true);
  });

  it('gives the "No newline at end of file" marker no tokens', async () => {
    expect(await loadLang('ruby')).toBe(true);
    const raw = 'diff --git a/x.rb b/x.rb\n--- a/x.rb\n+++ b/x.rb\n@@ -1,2 +1,2 @@\n def f\n-end\n\\ No newline at end of file\n+end # done\n\\ No newline at end of file\n';
    const [file] = parseDiff(raw);
    const markers = file.chunks[0].changes.filter((c) => c.content.startsWith('\\'));
    expect(markers).toHaveLength(2);
    const syn = diffSyntax(file, 'ruby')!;
    for (const m of markers) expect(syn.get(m)).toBeUndefined();
    const [, del, , add] = file.chunks[0].changes;
    expect(slots(syn.get(del))).toMatchObject({ end: 'kw' });
    expect(text(syn.get(add))).toBe('end # done');
  });

  it('uses the old path for deleted files', () => {
    const [file] = parseDiff('diff --git a/x.py b/x.py\ndeleted file mode 100644\n--- a/x.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-pass\n');
    expect(diffPath(file)).toBe('x.py');
  });
});
