// @vitest-environment node
import { describe, it } from 'vitest';
import { Linter, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from '../../eslint-rules/no-raw-style-scale.js';

// RuleTester drives its own describe/it; hand it vitest's.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const FILE = 'src/app/ui/Thing.tsx';
const MOBILE = 'src/app/mobile/Thing.tsx';

const ok = (code: string, filename = FILE, options?: unknown[]) => ({ code, filename, ...(options ? { options } : {}) });
/** An invalid case and the replacement its message must suggest. */
const bad = (code: string, suggestion: string, filename = FILE) => ({ code, suggestion, filename });

const invalid = [
  bad(`<div style={{ gap: 6 }}/>`, `'var(--s-1-5)' or <Row gap={1.5}>`),
  bad(`<div style={{ padding: '2px 6px' }}/>`, `'var(--s-0-5) var(--s-1-5)'`),
  bad(`<div style={{ fontSize: 10 }}/>`, `'var(--t-eyebrow)' or <Text size="eyebrow">`),
  bad(`<div style={{ marginTop: 4 }}/>`, `'var(--s-1)'`),
  bad(`<div style={{ borderRadius: 3 }}/>`, `'var(--r-2)'`),
  bad(`import type { CSSProperties } from 'react'; const s: CSSProperties = { gap: 8 };`, `'var(--s-2)'`),
  bad(`const s: React.CSSProperties = { columnGap: 12 };`, `'var(--s-3)'`),
  bad(`<div style={{ ...base, padding: '0 5px' }}/>`, `'0 var(--s-1-5)'`),
  bad(`<div style={{ marginLeft: -4 }}/>`, `'calc(-1 * var(--s-1))'`),
  bad(`<div style={{ borderRadius: 999 }}/>`, `'var(--r-pill)'`),
  bad(`<div style={{ fontSize: '11px' }}/>`, `'var(--t-caption)'`),
  bad(`<div style={{ gap: dense ? 4 : 'var(--s-2)' }}/>`, `'var(--s-1)'`),
  bad(`<div style={active ? { padding: 8 } : undefined}/>`, `'var(--s-2)'`),
  bad(`const box = (n: number): CSSProperties => ({ width: n, padding: 10 });`, `'var(--s-3)'`),
  bad(`function box(): CSSProperties { return { margin: 12 }; }`, `'var(--s-3)'`),
  bad(`const s = { gap: 2 } as CSSProperties;`, `'var(--s-0-5)'`),
  bad(`const s = { gap: 2 } satisfies CSSProperties;`, `'var(--s-0-5)'`),
  bad(`const S: Record<string, CSSProperties> = { row: { gap: 6 } };`, `'var(--s-1-5)'`),
  bad(`<div style={{ padding: \`0 \${x}px 4px\` }}/>`, `'var(--s-1)'`),
  bad(`<div style={{ fontSize: 14 }}/>`, `'var(--t-body)'`, MOBILE),
];

tester.run('argus/no-raw-style-scale', rule, {
  valid: [
    ok(`<div style={{ gap: 0 }}/>`),
    ok(`<div style={{ padding: '0' }}/>`),
    ok(`<div style={{ margin: '0px' }}/>`),
    ok(`<div style={{ gap: 'var(--s-2)' }}/>`),
    ok(`<div style={{ padding: 'var(--s-2) var(--s-3)' }}/>`),
    ok(`<div style={{ width: 240, height: 18, minWidth: 0 }}/>`),
    ok(`<div style={{ gap: dense ? 'var(--s-1)' : 'var(--s-2)' }}/>`),
    ok(`<div style={{ gap: spacing }}/>`),
    ok(`<div style={{ padding: \`\${y}px \${x}px\` }}/>`),
    ok(`const o = { gap: 6 };`),
    ok(`<div style={{ height: scaledPx(18), padding: pad(2) }}/>`),
    ok(`<div style={{ padding: 'calc(var(--s-2) + 1px)' }}/>`),
    ok(`<div style={{ fontSize: 'var(--t-caption)', lineHeight: 1.4 }}/>`),
    ok(`<div style={{ margin: '0 auto' }}/>`),
    ok(`<div data-style={{ gap: 6 }}/>`),
    ok(`<Foo labelStyle={{ gap: 6 }}/>`),
    ok(`<input style={{ fontSize: 16 }}/>`, MOBILE),
    ok(`<input style={{ fontSize: '16px' }}/>`, MOBILE),
    ok(`<input style={{ fontSize: 'var(--t-base)' }}/>`),
  ],
  invalid: invalid.map(({ code, filename }) => ({ code, filename, errors: [{ messageId: 'rawScale' }] })),
});

describe('message names the nearest token', () => {
  const linter = new Linter({ configType: 'flat' });
  const run = (code: string, filename: string) =>
    linter.verify(
      code,
      [
        {
          files: ['**/*.tsx'],
          languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { argus: { rules: { 'no-raw-style-scale': rule } } },
          rules: { 'argus/no-raw-style-scale': 'error' },
        },
      ],
      { filename },
    );

  it.each(invalid.map((c) => [c.code, c.suggestion, c.filename] as const))('%s → %s', (code, suggestion, filename) => {
    const messages = run(code, filename);
    if (messages.length !== 1 || !messages[0].message.includes(suggestion)) {
      throw new Error(`expected one message containing ${suggestion}, got ${JSON.stringify(messages.map((m) => m.message))}`);
    }
  });
});

tester.run('argus/no-raw-style-scale bannedTokens', rule, {
  valid: [
    ok(`<div style={{ fontSize: 'var(--t-body)' }}/>`, FILE, [{ bannedTokens: ['--t-base'] }]),
    ok(`const css = 'var(--t-base)';`, FILE, [{ bannedTokens: ['--t-base'] }]),
  ],
  invalid: [
    {
      code: `<div style={{ fontSize: 'var(--t-base)' }}/>`,
      filename: FILE,
      options: [{ bannedTokens: ['--t-base'] }],
      errors: [{ messageId: 'bannedToken' }],
    },
    {
      code: `<div style={{ transition: 'opacity var(--dur-fast) var(--ease-out)' }}/>`,
      filename: FILE,
      options: [{ bannedTokens: ['--ease-out'] }],
      errors: [{ messageId: 'bannedToken' }],
    },
  ],
});
