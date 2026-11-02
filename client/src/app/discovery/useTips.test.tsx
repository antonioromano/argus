import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DiscoveryState, SessionStatus } from '@argus/shared';
import { useTips, type TipsApi, type UseTipsArgs } from './useTips.js';
import { EMPTY_DISCOVERY, TIP_MIN_GAP_MS } from './discoveryState.js';
import { emitDiscovery } from './discoveryEvents.js';
import type { DiscoveryApi } from './useDiscovery.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
/** Every render's hook result; the latest is the live one. */
const results: TipsApi[] = [];
const latest = () => results[results.length - 1];

const NOW = 100 * TIP_MIN_GAP_MS;
const s = (id: string, status: SessionStatus = 'idle', folderPath = '/repo') => ({ id, status, folderPath });
const waiting3 = [s('a', 'waiting'), s('b', 'waiting'), s('c', 'waiting')];

/** A fake discovery store: patch applies synchronously and records every write. */
function fakeDisc(initial: DiscoveryState = EMPTY_DISCOVERY) {
  const writes: DiscoveryState[] = [];
  const disc: DiscoveryApi = {
    discovery: initial,
    patch: vi.fn(async (fn) => {
      disc.discovery = fn(disc.discovery);
      writes.push(disc.discovery);
    }),
  };
  return { disc, writes };
}

function Harness(props: UseTipsArgs) {
  results.push(useTips(props));
  return null;
}

function render(over: Partial<UseTipsArgs> & { disc: DiscoveryApi }) {
  const props: UseTipsArgs = {
    showTips: true, sessions: [], overlayOpen: false, introPending: false, isMainWindow: true,
    now: () => NOW, hasFocus: () => true, ...over,
  };
  act(() => root.render(<Harness {...props} />));
  return props;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('useTips', () => {
  it('shows the inbox tip at 3 waiting sessions and marks it seen at show time', () => {
    const { disc, writes } = fakeDisc();
    render({ disc, sessions: waiting3 });
    expect(latest().current?.id).toBe('waiting-inbox');
    expect(writes.at(-1)?.tipsSeen).toEqual(['waiting-inbox']);
    expect(writes.at(-1)?.tipLastShownAt).toBe(NOW);
  });

  it('shows nothing with tips off', () => {
    const { disc } = fakeDisc();
    render({ disc, sessions: waiting3, showTips: false });
    expect(latest().current).toBeNull();
  });

  it('shows at most one per launch, even after dismiss and a second trigger', () => {
    const { disc } = fakeDisc();
    const props = render({ disc, sessions: waiting3, now: () => NOW });
    expect(latest().current?.id).toBe('waiting-inbox');
    act(() => latest().dismiss());
    // Pretend an hour has passed: still capped by the per-launch counter.
    render({ ...props, disc, sessions: [...waiting3, s('d')], now: () => NOW + 2 * TIP_MIN_GAP_MS });
    expect(latest().current).toBeNull();
  });

  it('is blocked within 60 minutes of a persisted tipLastShownAt', () => {
    const { disc } = fakeDisc({ ...EMPTY_DISCOVERY, tipLastShownAt: NOW - TIP_MIN_GAP_MS + 1 });
    render({ disc, sessions: waiting3 });
    expect(latest().current).toBeNull();
  });

  it('waits while an overlay is open, then shows when it closes', () => {
    const { disc } = fakeDisc();
    const props = render({ disc, sessions: waiting3, overlayOpen: true });
    expect(latest().current).toBeNull();
    render({ ...props, disc, overlayOpen: false });
    expect(latest().current?.id).toBe('waiting-inbox');
  });

  it('never shows (or writes) in a secondary window', () => {
    const { disc } = fakeDisc();
    render({ disc, sessions: waiting3, isMainWindow: false });
    expect(latest().current).toBeNull();
    expect(disc.patch).not.toHaveBeenCalled();
  });

  it('records a used marker even with tips off', () => {
    const { disc, writes } = fakeDisc();
    render({ disc, showTips: false });
    act(() => emitDiscovery({ type: 'used', marker: 'inbox' }));
    expect(writes.at(-1)?.used).toEqual(['inbox']);
  });

  it('shows the search tip on a deep scroll', () => {
    const { disc } = fakeDisc();
    render({ disc, sessions: [s('a')] });
    act(() => emitDiscovery({ type: 'deep-scroll', sessionId: 'a' }));
    expect(latest().current?.id).toBe('session-search');
  });

  it('a create counts once the session list catches up', () => {
    const { disc } = fakeDisc({ ...EMPTY_DISCOVERY, used: ['broadcast'] });
    const props = render({ disc, sessions: [s('a')] });
    act(() => emitDiscovery({ type: 'create', gitRepo: true, worktree: false, folderPath: '/repo' }));
    expect(latest().current).toBeNull();
    render({ ...props, disc, sessions: [s('a'), s('b')] });
    expect(latest().current?.id).toBe('worktrees');
  });

  it('resetTips clears tipsSeen and tipLastShownAt', () => {
    const { disc, writes } = fakeDisc({ ...EMPTY_DISCOVERY, tipsSeen: ['broadcast'], tipLastShownAt: 5, used: ['inbox'] });
    render({ disc, showTips: false });
    act(() => latest().resetTips());
    expect(writes.at(-1)).toEqual({ ...EMPTY_DISCOVERY, used: ['inbox'] });
  });

  it('showTip shows a named tip past the rate limit', () => {
    const { disc } = fakeDisc({ ...EMPTY_DISCOVERY, tipLastShownAt: NOW });
    render({ disc });
    act(() => latest().showTip('broadcast'));
    expect(latest().current?.id).toBe('broadcast');
  });
});
