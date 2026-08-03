import { describe, it, expect } from 'vitest';
import { terminalSelectionToClipboard as clean } from './terminalCopy.js';

describe('terminalSelectionToClipboard', () => {
  it('returns empty input untouched', () => {
    expect(clean('')).toBe('');
  });

  it('strips the gutter every selected row shares', () => {
    expect(clean('  hello\n  world')).toBe('hello\nworld');
  });

  it('keeps indentation relative to the gutter', () => {
    expect(clean('  function f() {\n    return 1;\n  }')).toBe('function f() {\n  return 1;\n}');
  });

  it('strips leading padding from a single selected row', () => {
    expect(clean('  ⏺ Hey. What we build?')).toBe('⏺ Hey. What we build?');
  });

  it('does not dedent when the selection starts mid-row (drag from a column)', () => {
    // First row has no gutter because the drag began inside it — the shared
    // prefix is 0, so nothing is stripped and the user gets what they selected.
    expect(clean('timeouts in 3+ days\n  acceptance criterion')).toBe(
      'timeouts in 3+ days\n  acceptance criterion',
    );
  });

  it('trims the trailing cell padding off every row', () => {
    expect(clean('  hello   \n  world  ')).toBe('hello\nworld');
  });

  // ── unwrapping ────────────────────────────────────────────────────────────

  it('rejoins a paragraph the agent hard-wrapped at the pane width', () => {
    const selection = [
      '  Zero timeouts in 3+ days — well past the 48h',
      '  acceptance criterion. branded_links list path',
      '  clean: no timeout spans, no new error types on',
      '  GET /v1/links.',
    ].join('\n');
    expect(clean(selection)).toBe(
      'Zero timeouts in 3+ days — well past the 48h acceptance criterion. ' +
        'branded_links list path clean: no timeout spans, no new error types on GET /v1/links.',
    );
  });

  it('folds a wrapped continuation back into its bullet', () => {
    const selection = ['  - Index live in prod since 2026-07-17, 0 timeouts', '  verified (was 88/week)'].join('\n');
    expect(clean(selection)).toBe('- Index live in prod since 2026-07-17, 0 timeouts verified (was 88/week)');
  });

  it('keeps authored breaks — short rows leave room the next word would have fit into', () => {
    const selection = [
      '  - Index live in prod since 2026-07-17',
      '  - Pending: verification comment on PLAT-671',
      '  - Open: hint-strategy decision',
    ].join('\n');
    expect(clean(selection)).toBe(
      '- Index live in prod since 2026-07-17\n- Pending: verification comment on PLAT-671\n- Open: hint-strategy decision',
    );
  });

  it('never folds a row that opens a new bullet, even after a full-width row', () => {
    const selection = [
      '  - a bullet long enough to reach the wrap column ok',
      '  - the next bullet starts here and must stay put',
    ].join('\n');
    expect(clean(selection)).toBe(
      '- a bullet long enough to reach the wrap column ok\n- the next bullet starts here and must stay put',
    );
  });

  it('treats a blank row as a paragraph break', () => {
    const selection = [
      '  Post-deploy error landscape (what is left, and',
      '',
      '  Error: Illegal mix of collations on the table x',
    ].join('\n');
    expect(clean(selection)).toBe(
      'Post-deploy error landscape (what is left, and\n\nError: Illegal mix of collations on the table x',
    );
  });

  it('never folds box-drawing chrome into the row above', () => {
    const selection = [
      '  a status line that runs right up to the margin x',
      '  ─────────────────────────────────────────────',
      '  ❯ ',
    ].join('\n');
    expect(clean(selection)).toBe(
      'a status line that runs right up to the margin x\n─────────────────────────────────────────────\n❯',
    );
  });

  it('never lets a rule swallow the prose beneath it', () => {
    // The mirror of the case above, and the one that actually shipped broken: a
    // separator runs to full width, so the row under it always looks like a
    // forced continuation. Seen on a live pane.
    const selection = [
      '  a paragraph row wide enough to set the wrap width',
      '  ────────────────────────────────────────',
      '  Error: GET /v1/account/domains/:domain_id',
    ].join('\n');
    expect(clean(selection)).toBe(
      'a paragraph row wide enough to set the wrap width\n' +
        '────────────────────────────────────────\n' +
        'Error: GET /v1/account/domains/:domain_id',
    );
  });

  it('still recognises a rule when the selection has no shared gutter to strip', () => {
    // A whole-screen drag includes column-0 rows (prompt, spinner), so the gutter
    // is 0 and every transcript row keeps its indent. Frame detection has to see
    // through that indent, or the rule reverts to swallowing the row below it.
    const selection = [
      '⏺ a paragraph row wide enough to set the wrap width',
      '',
      '  ────────────────────────────────────────',
      '  Error: GET /v1/account/domains/:domain_id',
    ].join('\n');
    expect(clean(selection)).toBe(
      '⏺ a paragraph row wide enough to set the wrap width\n\n' +
        '  ────────────────────────────────────────\n' +
        '  Error: GET /v1/account/domains/:domain_id',
    );
  });

  it('keeps a re-indented row apart (nested code, not a wrap continuation)', () => {
    const selection = [
      '  const rows = await fetchEverythingFromTheTable()',
      '      .filter(Boolean)',
    ].join('\n');
    expect(clean(selection)).toBe('const rows = await fetchEverythingFromTheTable()\n    .filter(Boolean)');
  });

  it('tolerates the one-space hang the agent uses inside a wrapped clause', () => {
    const selection = [
      '  Error: Illegal mix of collations (latin1_swedish',
      '   vs utf8mb4_bin) on branded_domain_nameservers',
    ].join('\n');
    expect(clean(selection)).toBe(
      'Error: Illegal mix of collations (latin1_swedish vs utf8mb4_bin) on branded_domain_nameservers',
    );
  });

  it('rejoins a mid-word hard break without inserting a space', () => {
    // A token longer than the whole line can only have arrived split, so the two
    // fragments belong together with nothing between them.
    const selection = [
      '  https://gitlab.rebrandly.com/rebrandly/api-pro',
      '  duct/-/merge_requests/4417',
    ].join('\n');
    expect(clean(selection)).toBe('https://gitlab.rebrandly.com/rebrandly/api-product/-/merge_requests/4417');
  });

  it('does not let a table frame inflate the wrap width and starve the prose above it', () => {
    // A frame runs wider than the text it surrounds. Reading it as the wrap width
    // makes near-full prose rows look like they had room to spare, so their forced
    // breaks survive into the clipboard. Seen on a live pane before it was fixed.
    const selection = [
      '  2. New candidate ticket: collation mismatch on',
      '  branded_domain_nameservers — now the top prod',
      '  DB error; fix = column/table charset to',
      '  utf8mb4 or convert param (same table needs the',
      '  │ Since deploy Fri  │                         │',
      '  └───────────────────┴─────────────────────────┘',
    ].join('\n');
    expect(clean(selection)).toBe(
      [
        '2. New candidate ticket: collation mismatch on branded_domain_nameservers — now the top prod ' +
          'DB error; fix = column/table charset to utf8mb4 or convert param (same table needs the',
        '│ Since deploy Fri  │                         │',
        '└───────────────────┴─────────────────────────┘',
      ].join('\n'),
    );
  });

  it('keeps an authored key/value list apart when a wider block sets the wrap width', () => {
    // The inverse hazard: these rows are short because they were written short,
    // not because anything wrapped. Nothing here may fold.
    const selection = [
      '  Error: Deadlock account_profile_cycles',
      '  Count (3.3d): 3',
      '  Note: Known finding #4, retry covers',
      '',
      '  a wider paragraph elsewhere in the same copy ok',
    ].join('\n');
    expect(clean(selection)).toBe(
      'Error: Deadlock account_profile_cycles\nCount (3.3d): 3\nNote: Known finding #4, retry covers\n\n' +
        'a wider paragraph elsewhere in the same copy ok',
    );
  });

  it('leaves a lone row alone once its gutter is gone', () => {
    expect(clean('  a single row that happens to be quite wide')).toBe(
      'a single row that happens to be quite wide',
    );
  });

  it('is idempotent — copying already-clean text changes nothing', () => {
    const once = clean('  wrapped text that continues onto the row below\n  below this one');
    expect(clean(once)).toBe(once);
  });
});
