import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { MAX_REMEMBERED_LISTS, resetSessionPrsCache, useLastSessionPrs, useSessionPrs } from './useSessionPrs.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getSessionPrs = vi.fn();
vi.mock('../services/api.js', () => ({ api: { getSessionPrs: (id: string) => getSessionPrs(id) } }));

afterEach(() => resetSessionPrsCache());

describe('useSessionPrs remembered lists', () => {
  it('keeps at most MAX_REMEMBERED_LISTS sessions, dropping the least recently read', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const entry = [{ url: 'https://github.com/o/r/pull/1', pr: null, folderBranch: false, linked: true }];
    getSessionPrs.mockResolvedValue({ enabled: true, prs: entry });
    const seen: Record<string, unknown> = {};
    function Probe({ id }: { id: string }) {
      useSessionPrs(id, true);
      return null;
    }
    function Reader({ id }: { id: string }) {
      seen[id] = useLastSessionPrs(id);
      return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    for (let i = 0; i <= MAX_REMEMBERED_LISTS; i++) {
      await act(async () => { root.render(createElement(Probe, { id: `s${i}` })); });
    }
    await act(async () => {
      root.render(createElement('div', null, createElement(Reader, { id: 's0' }), createElement(Reader, { id: `s${MAX_REMEMBERED_LISTS}` })));
    });
    expect(seen.s0).toBeUndefined();
    expect(seen[`s${MAX_REMEMBERED_LISTS}`]).toEqual(entry);
    act(() => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });
});
