import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FindInFilesResponse } from '@argus/shared';

const findInFiles = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: { findInFiles: (...args: unknown[]) => findInFiles(...args) },
  ApiError: class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } },
}));

import { FindInFilesPanel } from './FindInFilesPanel.js';
import { splitHighlights, flattenRows } from './findInFilesRows.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

const response: FindInFilesResponse = {
  query: 'needle',
  totalMatches: 3,
  truncated: false,
  files: [
    { path: '/repo/src/a.ts', matches: [
      { line: 1, column: 7, preview: 'const needle = 1;', ranges: [[6, 12]] },
      { line: 4, column: 1, preview: 'needle()', ranges: [[0, 6]] },
    ] },
    { path: '/repo/notes.md', matches: [{ line: 2, column: 3, preview: 'a needle', ranges: [[2, 8]] }] },
  ],
};

function Harness({ onOpenMatch, onClose }: { onOpenMatch: (p: string, l: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  return <FindInFilesPanel folderPath="/repo" query={q} onQueryChange={setQ} focusNonce={0} onOpenMatch={onOpenMatch} onClose={onClose} />;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  await act(async () => {});
}

const searchBox = () => document.querySelector('input[aria-label="Search text"]') as HTMLInputElement;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  findInFiles.mockReset();
  findInFiles.mockResolvedValue(response);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('splitHighlights', () => {
  it('splits a preview into plain and highlighted segments', () => {
    expect(splitHighlights('a foo b foo', [[2, 5], [8, 11]])).toEqual([
      { text: 'a ', hit: false },
      { text: 'foo', hit: true },
      { text: ' b ', hit: false },
      { text: 'foo', hit: true },
    ]);
  });

  it('ignores empty, overlapping and out-of-range ranges', () => {
    expect(splitHighlights('abcdef', [[1, 3], [2, 4], [5, 5], [5, 99]])).toEqual([
      { text: 'a', hit: false },
      { text: 'bc', hit: true },
      { text: 'd', hit: true },
      { text: 'e', hit: false },
      { text: 'f', hit: true },
    ]);
  });
});

describe('flattenRows', () => {
  it('hides the matches of a collapsed file', () => {
    expect(flattenRows(response.files, new Set()).length).toBe(5);
    expect(flattenRows(response.files, new Set(['/repo/src/a.ts'])).map((r) => r.kind)).toEqual(['file', 'file', 'match']);
  });
});

describe('FindInFilesPanel', () => {
  it('groups results by file with highlighted previews, and opens a match at its line', async () => {
    const onOpenMatch = vi.fn();
    act(() => root.render(<Harness onOpenMatch={onOpenMatch} onClose={() => {}} />));
    typeInto(searchBox(), 'needle');
    await settle();

    expect(findInFiles).toHaveBeenCalledWith('/repo', 'needle', expect.objectContaining({ regex: false, caseSensitive: false, wholeWord: false }), expect.anything());
    const items = [...document.querySelectorAll('[role="treeitem"]')];
    expect(items.map((el) => el.getAttribute('aria-expanded'))).toEqual(['true', null, null, 'true', null]);
    expect(items[0].textContent).toContain('a.ts');
    expect(items[0].textContent).toContain('src');
    expect([...document.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['needle', 'needle', 'needle']);
    expect(document.body.textContent).toContain('3 results in 2 files');

    act(() => (items[2] as HTMLElement).click());
    expect(onOpenMatch).toHaveBeenCalledWith('/repo/src/a.ts', 4);
  });

  it('collapses a file group on click', async () => {
    act(() => root.render(<Harness onOpenMatch={() => {}} onClose={() => {}} />));
    typeInto(searchBox(), 'needle');
    await settle();
    act(() => (document.querySelector('[role="treeitem"]') as HTMLElement).click());
    expect(document.querySelectorAll('[role="treeitem"]').length).toBe(3);
  });

  it('sends the toggled options and include/exclude globs', async () => {
    act(() => root.render(<Harness onOpenMatch={() => {}} onClose={() => {}} />));
    for (const label of ['Match case', 'Match whole word', 'Use regular expression', 'Toggle include/exclude filters']) {
      act(() => (document.querySelector(`button[aria-label="${label}"]`) as HTMLElement).click());
    }
    typeInto(document.querySelector('input[aria-label="Files to include"]') as HTMLInputElement, 'src/**');
    typeInto(document.querySelector('input[aria-label="Files to exclude"]') as HTMLInputElement, '*.md');
    typeInto(searchBox(), 'ne+dle');
    await settle();
    expect(findInFiles).toHaveBeenLastCalledWith('/repo', 'ne+dle', {
      regex: true, caseSensitive: true, wholeWord: true, include: 'src/**', exclude: '*.md',
    }, expect.anything());
  });

  it('navigates with the arrows and opens with Enter; Escape closes', async () => {
    const onOpenMatch = vi.fn();
    const onClose = vi.fn();
    act(() => root.render(<Harness onOpenMatch={onOpenMatch} onClose={onClose} />));
    const input = searchBox();
    typeInto(input, 'needle');
    await settle();
    const key = (k: string) => act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    key('ArrowDown');
    key('Enter');
    expect(onOpenMatch).toHaveBeenCalledWith('/repo/src/a.ts', 1);
    key('Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server error for an invalid regex', async () => {
    const { ApiError } = await import('../../services/api.js');
    findInFiles.mockRejectedValue(new ApiError(400, 'regex parse error: unclosed group'));
    act(() => root.render(<Harness onOpenMatch={() => {}} onClose={() => {}} />));
    typeInto(searchBox(), 'fo(o');
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('unclosed group');
  });
});
