import { describe, it, expect } from 'vitest';
import {
  inlineToHtml as inline,
  markBoldRuns,
  terminalCopyFlavors,
  terminalTextToHtml,
  xtermSelectionWithBold,
} from './terminalRichCopy.js';
import { BOLD_OFF as OFF, BOLD_ON as ON, withStartColumn } from './terminalCopy.js';

/**
 * The clipboard HTML reduced to its meaning, for readable assertions: the Docs
 * wrapper and presentational attributes go, and each styled span becomes the
 * semantic tag its style encodes (700 → b, italic → i, line-through → s,
 * monospace → code) or bare text.
 */
function simplify(rendered: string): string {
  return rendered
    .replace('<meta charset="utf-8">', '')
    .replace(/^<b style="font-weight:normal;" id="docs-internal-guid-[^"]*">([\s\S]*)<\/b>$/, '$1')
    .replace(/<span style="([^"]*)">([^<]*)<\/span>/g, (_m, style: string, text: string) => {
      let t = text;
      if (style.includes('monospace')) t = `<code>${t}</code>`;
      if (style.includes('line-through')) t = `<s>${t}</s>`;
      if (style.includes('italic')) t = `<i>${t}</i>`;
      if (style.includes('font-weight:700')) t = `<b>${t}</b>`;
      return t;
    })
    .replace(/<\/b><b>/g, '')
    .replace(/ (?:style|dir|role|aria-level)="[^"]*"/g, '');
}
const html = (text: string): string => simplify(terminalTextToHtml(text, 'test'));

describe('inlineToHtml', () => {
  it('escapes HTML in the source text', () => {
    expect(inline('a <b> & "c"')).toBe('a &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('renders both **x** and Slack-style *x* as bold', () => {
    expect(inline('**one** and *two*')).toBe('<b>one</b> and <b>two</b>');
  });

  it('leaves loose asterisks alone', () => {
    expect(inline('2 * 3 * 4')).toBe('2 * 3 * 4');
  });

  it('renders _x_ as italic but keeps snake_case identifiers', () => {
    expect(inline('_note_ on int_organizations_teammates')).toBe('<i>note</i> on int_organizations_teammates');
  });

  it('renders code spans verbatim, without reading markup inside them', () => {
    expect(inline('run `a *b* <c>` now')).toBe('run <code>a *b* &lt;c&gt;</code> now');
  });

  it('links markdown links and bare URLs', () => {
    expect(inline('[docs](https://x.io/a) or https://y.io/b.')).toBe(
      '<a href="https://x.io/a">docs</a> or <a href="https://y.io/b">https://y.io/b</a>.',
    );
  });

  it('renders ~~x~~ as strikethrough', () => {
    expect(inline('~~old~~ new')).toBe('<s>old</s> new');
  });
});

describe('terminalTextToHtml', () => {
  it('returns nothing for blank input', () => {
    expect(terminalTextToHtml('  \n ')).toBe('');
  });

  it('writes the Google Docs clipboard dialect Slack builds real lists from', () => {
    const rendered = terminalTextToHtml('• a', 'abc');
    expect(rendered).toMatch(/^<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">/);
    expect(rendered).toContain('<li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr"');
    expect(rendered).toContain('role="presentation"><span style="');
  });

  it('declares UTF-8 so bullets and dashes survive the pasteboard', () => {
    expect(terminalTextToHtml('a — b', 'x')).toMatch(/^<meta charset="utf-8">/);
  });

  it('gives every row its own paragraph and a blank row a gap', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one</p><p>two</p><br><p>three</p>');
  });

  it('turns bullet rows into a real list', () => {
    expect(html('• a\n• b\n- c')).toBe('<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
  });

  it('turns numbered rows into an ordered list, keeping the start number', () => {
    expect(html('1. a\n2. b')).toBe('<ol><li><p>a</p></li><li><p>b</p></li></ol>');
    expect(html('3) c')).toBe('<ol start="3"><li><p>c</p></li></ol>');
  });

  it('nests lists the Docs way, as siblings of the parent item, styled by depth', () => {
    expect(html('• a\n  • a1\n  • a2\n• b')).toBe(
      '<ul><li><p>a</p></li><ul><li><p>a1</p></li><li><p>a2</p></li></ul><li><p>b</p></li></ul>',
    );
    expect(terminalTextToHtml('1. a\n   1. b', 'x')).toMatch(/decimal.*lower-alpha/);
  });

  it('starts a list straight after a paragraph row', () => {
    expect(html('Title\n- a')).toBe('<p>Title</p><ul><li><p>a</p></li></ul>');
  });

  it('continues an item with the indented row under it', () => {
    expect(html('• item\n  more of it\nafter')).toBe('<ul><li><p>item<br>more of it</p></li></ul><p>after</p>');
  });

  it('keeps a list open across a blank row between items', () => {
    expect(html('• a\n\n• b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
  });

  it('switches list type at the same indent', () => {
    expect(html('• a\n1. b')).toBe('<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>');
  });

  it('drops the agent response markers', () => {
    expect(html('⏺ Done.\n⎿ ok')).toBe('<p>Done.</p><p>ok</p>');
  });

  it('keeps box-drawn tables monospaced', () => {
    expect(html('┌──┐\n│ a│\n└──┘\n\nafter')).toBe(
      '<p><code>┌──┐</code></p><p><code>│ a│</code></p><p><code>└──┘</code></p><br><p>after</p>',
    );
  });

  it('links with an underlined span inside the anchor', () => {
    expect(terminalTextToHtml('see https://a.io', 'x')).toMatch(
      /<a href="https:\/\/a\.io" style="text-decoration:none;"><span style="[^"]*text-decoration:underline;/,
    );
  });

  describe('code', () => {
    it('reads `#` and `*` rows as code text, not markdown', () => {
      expect(html('# install deps\nnpm ci')).toBe('<p># install deps</p><p>npm ci</p>');
      expect(html('* * * * * /usr/bin/backup.sh')).toBe('<p>* * * * * /usr/bin/backup.sh</p>');
    });

    it('keeps an indented block monospaced, indentation and all', () => {
      expect(html('def f(x):\n    return 1')).toBe('<p><code>def f(x):</code></p><p><code>    return 1</code></p>');
    });

    it('keeps a backslash-continued command monospaced', () => {
      expect(html('docker run \\\n  -e A=1 \\\n  node:22')).toBe(
        '<p><code>docker run \\</code></p><p><code>  -e A=1 \\</code></p><p><code>  node:22</code></p>',
      );
    });

    it('does not read flags as list items', () => {
      expect(html('--dry-run\n-v')).toBe('<p>--dry-run</p><p>-v</p>');
    });
  });

  it('renders a Slack-style review note as sections of real lists', () => {
    const text = [
      '*PLG Business User*',
      '  • *Definition:* business email + own domain.',
      '  • *QR:* we can measure it now.',
      '',
      '*SLG*',
      '  • *Webhooks:* these are countable, see `int_organizations_teammates`.',
    ].join('\n');
    expect(html(text)).toBe(
      '<p><b>PLG Business User</b></p>' +
        '<ul><li><p><b>Definition:</b> business email + own domain.</p></li>' +
        '<li><p><b>QR:</b> we can measure it now.</p></li></ul>' +
        '<br><p><b>SLG</b></p>' +
        '<ul><li><p><b>Webhooks:</b> these are countable, see <code>int_organizations_teammates</code>.</p></li></ul>',
    );
  });
});

/** Cells for markBoldRuns from text, bolding the characters under `^` in `mask`. */
const cells = (text: string, mask = '') => [...text].map((ch, i) => ({ ch, bold: mask[i] === '^' }));

describe('bold from cell attributes', () => {
  it('marks a bold run tight around its visible characters', () => {
    expect(markBoldRuns(cells('  Definition: plain  ', '  ^^^^^^^^^^^^'))).toBe(`  ${ON}Definition:${OFF} plain`);
  });

  it('marks nothing on a row without bold', () => {
    expect(markBoldRuns(cells('plain  '))).toBe('plain');
  });

  it('keeps trailing whitespace when the row soft-wraps on', () => {
    expect(markBoldRuns(cells('word '), true)).toBe('word ');
  });

  it('renders marked runs bold and strips them from the plain text', () => {
    const { text, html: rendered } = terminalCopyFlavors(`• ${ON}QR:${OFF} measurable now`);
    expect(text).toBe('• QR: measurable now');
    expect(simplify(rendered)).toBe('<ul><li><p><b>QR:</b> measurable now</p></li></ul>');
  });

  it('carries a run that opens on the bullet into the item', () => {
    expect(html(`${ON}• All bold${OFF}`)).toBe('<ul><li><p><b>All bold</b></p></li></ul>');
  });

  it('renders a bold heading row as a bold paragraph', () => {
    expect(html(`${ON}PLG Business User${OFF}\n• a`)).toBe('<p><b>PLG Business User</b></p><ul><li><p>a</p></li></ul>');
  });

  it('unwraps marked rows by their visible width, merging a run split by the wrap', () => {
    const selection = [
      `  ${ON}Zero timeouts in 3+ days — well past${OFF}`,
      `  ${ON}the 48h${OFF} acceptance criterion.`,
    ].join('\n');
    const { text, html: rendered } = terminalCopyFlavors(selection);
    expect(text).toBe('Zero timeouts in 3+ days — well past the 48h acceptance criterion.');
    expect(simplify(rendered)).toBe('<p><b>Zero timeouts in 3+ days — well past the 48h</b> acceptance criterion.</p>');
  });

  it('keeps marks out of code spans and links, merging runs split only by a space', () => {
    expect(inline(`${ON}\`x\`${OFF} ${ON}https://a.io${OFF}`)).toBe(
      '<b><code>x</code> <a href="https://a.io">https://a.io</a></b>',
    );
  });
});

describe('xtermSelectionWithBold', () => {
  /** A fake xterm over rows of [text, boldMask, isWrapped]. */
  const fake = (rows: [string, string, boolean?][], start: [number, number], end: [number, number]) => ({
    hasSelection: () => true,
    getSelection: () => 'PLAIN',
    getSelectionPosition: () => ({ start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] } }),
    buffer: {
      active: {
        getLine: (y: number) => {
          const row = rows[y];
          if (!row) return undefined;
          const [text, mask, wrapped = false] = row;
          return {
            isWrapped: wrapped,
            length: text.length,
            getCell: (x: number) => ({ getChars: () => text[x].trim() ? text[x] : '', getWidth: () => 1, isBold: () => (mask[x] === '^' ? 1 : 0) }),
          };
        },
      },
    },
  });

  it('returns getSelection() untouched when nothing selected is bold', () => {
    expect(xtermSelectionWithBold(fake([['plain row', '']], [0, 0], [9, 0]))).toBe('PLAIN');
  });

  it('marks bold runs across rows, honouring the selection columns', () => {
    const t = fake([['xx Title  ', '   ^^^^^'], ['• item    ', '']], [3, 0], [6, 1]);
    expect(xtermSelectionWithBold(t)).toBe(withStartColumn(`${ON}Title${OFF}\n• item`, 3));
  });

  it('joins a soft-wrapped row without a break', () => {
    const t = fake([['bold wrap', '^^^^^^^^^'], ['ped tail', '^^^', true]], [0, 0], [8, 1]);
    expect(xtermSelectionWithBold(t)).toBe(`${ON}bold wrapped${OFF} tail`);
  });
});
