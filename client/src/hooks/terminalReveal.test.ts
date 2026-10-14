import { describe, it, expect, vi } from 'vitest';
import { applyTerminalReveal, requestTerminalReveal, takeTerminalReveal, TERMINAL_REVEAL_EVENT } from './terminalReveal.js';

const fakeTerminal = (rows: number) => ({ select: vi.fn(), clearSelection: vi.fn(), buffer: { active: { length: rows } } }) as never;
const fakeAddon = () => ({ findNext: vi.fn(() => true), findPrevious: vi.fn(() => true) });

describe('terminalReveal', () => {
  it('parks one request per session and announces it', () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<{ sessionId: string }>).detail.sessionId);
    window.addEventListener(TERMINAL_REVEAL_EVENT, on);
    requestTerminalReveal('s1', { query: 'x', line: 3 });
    window.removeEventListener(TERMINAL_REVEAL_EVENT, on);
    expect(seen).toEqual(['s1']);
    expect(takeTerminalReveal('s1')).toEqual({ query: 'x', line: 3 });
    expect(takeTerminalReveal('s1')).toBeUndefined();
  });

  it('with a row, searches forward from that row', () => {
    const t = fakeTerminal(100);
    const addon = fakeAddon();
    applyTerminalReveal(t, addon, { query: 'boom', line: 40 });
    expect((t as unknown as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledWith(0, 40, 0);
    expect(addon.findNext).toHaveBeenCalledWith('boom', expect.objectContaining({ incremental: true, caseSensitive: false, regex: false }));
  });

  it('without a usable row, lands on the newest match', () => {
    const addon = fakeAddon();
    applyTerminalReveal(fakeTerminal(10), addon, { query: 'boom', line: 99 });
    applyTerminalReveal(fakeTerminal(10), addon, { query: 'boom' });
    expect(addon.findPrevious).toHaveBeenCalledTimes(2);
    expect(addon.findNext).not.toHaveBeenCalled();
  });
});
