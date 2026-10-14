import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SearchResponse } from '@argus/shared';
import { SessionSearch, SEARCH_DEBOUNCE_MS } from './SessionSearch.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const response: SearchResponse = {
  query: 'err',
  truncated: false,
  results: [
    {
      sessionId: 'a', sessionName: 'api', agentType: 'claude', scrollback: 'live',
      hits: [
        { source: 'scrollback', snippet: 'npm ERR! one', matchStart: 4, matchLength: 3, line: 12 },
        { source: 'transcript', role: 'user', snippet: 'fix the err', matchStart: 8, matchLength: 3 },
      ],
    },
    {
      sessionId: 'b', sessionName: 'web', agentType: 'shell', scrollback: 'frozen',
      hits: [{ source: 'scrollback', snippet: 'err two', matchStart: 0, matchLength: 3 }],
    },
  ],
};

const input = () => container.querySelector('input') as HTMLInputElement;
const key = (k: string) => act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS); });
}

function render() {
  const props = { search: vi.fn<(q: string, signal: AbortSignal) => Promise<SearchResponse>>(async () => response), onJump: vi.fn(), onClose: vi.fn() };
  act(() => root.render(<SessionSearch {...props} />));
  return props;
}

const selectedText = () => container.querySelector('[role="option"][aria-selected="true"]')?.textContent;

describe('SessionSearch', () => {
  it('debounces the query and groups results by session', async () => {
    const props = render();
    await type('e');
    expect(props.search).not.toHaveBeenCalled(); // too short
    await type('er');
    await type('err');
    expect(props.search).toHaveBeenCalledTimes(2);
    expect(props.search.mock.calls.at(-1)![0]).toBe('err');
    const groups = container.querySelectorAll('[role="group"]');
    expect([...groups].map((g) => g.getAttribute('aria-label'))).toEqual(['api', 'web']);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it('moves the selection across groups with the arrows and jumps on Enter', async () => {
    const props = render();
    await type('err');
    expect(selectedText()).toContain('npm ERR! one');
    key('ArrowDown');
    key('ArrowDown');
    expect(selectedText()).toContain('err two');
    key('ArrowDown'); // clamps at the end
    expect(selectedText()).toContain('err two');
    key('ArrowUp');
    expect(selectedText()).toContain('fix the err');
    key('Enter');
    expect(props.onJump).toHaveBeenCalledWith('a', response.results[0]!.hits[1], 'err');
  });

  it('a click jumps to that hit; Escape closes', async () => {
    const props = render();
    await type('err');
    act(() => { (container.querySelectorAll('[role="option"]')[2] as HTMLElement).click(); });
    expect(props.onJump).toHaveBeenCalledWith('b', response.results[1]!.hits[0], 'err');
    key('Escape');
    expect(props.onClose).toHaveBeenCalled();
  });
});
