import { describe, it, expect, vi } from 'vitest';
import { emitDiscovery, onDiscovery } from './discoveryEvents.js';

describe('discovery events', () => {
  it('delivers to subscribers until they unsubscribe', () => {
    const fn = vi.fn();
    const off = onDiscovery(fn);
    emitDiscovery({ type: 'used', marker: 'inbox' });
    off();
    emitDiscovery({ type: 'used', marker: 'broadcast' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ type: 'used', marker: 'inbox' });
  });

  it('emitting with no listener is a no-op', () => {
    expect(() => emitDiscovery({ type: 'deep-scroll', sessionId: 's1' })).not.toThrow();
  });

  it('a throwing listener does not block the others', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    const offBad = onDiscovery(() => { throw new Error('boom'); });
    const offGood = onDiscovery(good);
    emitDiscovery({ type: 'used', marker: 'inbox' });
    expect(good).toHaveBeenCalledTimes(1);
    offBad(); offGood(); spy.mockRestore();
  });
});
