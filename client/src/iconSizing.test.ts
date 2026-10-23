// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Icons must scale with the Interface font size. The <Icon> primitive is the
// only place a lucide icon gets its size (through the --ui-scale-aware tokens),
// so a fixed-pixel icon anywhere else is a regression: it stays small when the
// user picks a large font. These checks are a grep, not a render — cheap and
// exhaustive over every component file.

const SRC = fileURLToPath(new URL('.', import.meta.url));
const WRAPPER = 'components/primitives/Icon.tsx';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Value (non-type) names a file imports from lucide-react. */
function lucideImports(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const raw of m[1].split(',')) {
      const spec = raw.trim();
      if (!spec || spec.startsWith('type ')) continue;
      names.push(spec.split(/\s+as\s+/).pop()!.trim());
    }
  }
  return names;
}

/** Opening JSX tags `<Name …>` (attributes included), honouring `{…}` nesting. */
function* jsxTags(src: string): Generator<{ name: string; tag: string; line: number }> {
  for (const m of src.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    let depth = 0;
    let i = m.index! + 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    yield { name: m[1], tag: src.slice(m.index!, i + 1), line: src.slice(0, m.index!).split('\n').length };
  }
}

const files = sourceFiles(SRC)
  .map((path) => ({ rel: relative(SRC, path), src: readFileSync(path, 'utf8') }))
  .filter((f) => f.rel !== WRAPPER);

describe('icon sizing', () => {
  it('renders lucide icons only through <Icon>', () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      const lucide = new Set(lucideImports(src));
      for (const { name, line } of jsxTags(src)) {
        if (lucide.has(name)) offenders.push(`${rel}:${line} <${name}>`);
      }
    }
    expect(offenders, 'use <Icon icon={X} size=…> instead').toEqual([]);
  });

  it('keeps lucide props (strokeWidth) off every component but <Icon>', () => {
    // Catches icons held in variables (`const Glyph = item.icon; <Glyph size={14} …/>`),
    // which the import check above cannot see.
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      if (!/\.tsx$/.test(rel)) continue;
      for (const { name, tag, line } of jsxTags(src)) {
        if (name !== 'Icon' && name !== 'svg' && /^[A-Z]/.test(name) && /\bstrokeWidth=/.test(tag)) {
          offenders.push(`${rel}:${line} <${name}>`);
        }
      }
      for (const m of src.matchAll(/createElement\(\s*([\w.]+)[^;]*?\bstrokeWidth:/g)) {
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} createElement(${m[1]})`);
      }
    }
    expect(offenders, 'render the icon with <Icon icon={…}>').toEqual([]);
  });

  it('gives no inline <svg> a fixed pixel width/height attribute', () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      for (const { name, tag, line } of jsxTags(src)) {
        if (name === 'svg' && /\s(width|height)=/.test(tag)) offenders.push(`${rel}:${line}`);
      }
    }
    expect(offenders, 'size inline svgs with scaledPx() in style').toEqual([]);
  });

  it('gives <Icon> no pixel-string or fixed style size', () => {
    // `size` takes a token or a design number that <Icon> scales; a CSS length
    // string ("14px") or a numeric style width/height would bypass the scale.
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      for (const { name, tag, line } of jsxTags(src)) {
        if (name !== 'Icon') continue;
        if (/\bsize=["{]\s*['"`]?\d+(\.\d+)?px/.test(tag) || /\b(width|height):\s*\d/.test(tag)) {
          offenders.push(`${rel}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
