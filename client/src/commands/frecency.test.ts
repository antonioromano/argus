import { describe, it, expect } from 'vitest';
import { FRECENCY_KEY, MAX_IDS, createFrecency, runWeight, type FrecencyStorage } from './frecency.js';

const DAY = 86_400_000;

function memory(): FrecencyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('frecency', () => {
  it('weights each run by its age bucket', () => {
    expect(runWeight(0)).toBe(100);
    expect(runWeight(4 * DAY - 1)).toBe(100);
    expect(runWeight(4 * DAY)).toBe(70);
    expect(runWeight(20 * DAY)).toBe(50);
    expect(runWeight(60 * DAY)).toBe(30);
    expect(runWeight(365 * DAY)).toBe(10);
  });

  it('records runs and keeps at most 10 per id', () => {
    const store = memory();
    let t = 1_000_000;
    const f = createFrecency(() => store, () => t);
    for (let i = 0; i < 12; i++) { f.record('a'); t += 1; }
    expect(JSON.parse(store.data.get(FRECENCY_KEY)!).a).toHaveLength(10);
    expect(f.scores().get('a')).toBe(1000);
  });

  it('scores recent runs above old ones', () => {
    const store = memory();
    let t = 100 * DAY;
    const f = createFrecency(() => store, () => t);
    f.record('old');
    t += 50 * DAY;
    f.record('new');
    expect(f.scores().get('new')!).toBeGreaterThan(f.scores().get('old')!);
  });

  it('caps the store, evicting the lowest score first', () => {
    const store = memory();
    let t = 1000 * DAY;
    const f = createFrecency(() => store, () => t);
    const seed: Record<string, number[]> = {};
    for (let i = 0; i < MAX_IDS; i++) seed[`id${i}`] = [t];
    seed.stale = [t - 200 * DAY];
    seed.id0 = [t, t];
    store.setItem(FRECENCY_KEY, JSON.stringify(seed));
    t += 1;
    f.record('fresh');
    const ids = Object.keys(JSON.parse(store.data.get(FRECENCY_KEY)!));
    expect(ids).toHaveLength(MAX_IDS);
    expect(ids).not.toContain('stale');
    expect(ids).toContain('fresh');
    expect(ids).toContain('id0');
  });

  it('reads corrupt JSON or a throwing storage as an empty history, without throwing', () => {
    const corrupt = memory();
    corrupt.setItem(FRECENCY_KEY, '{nope');
    expect(createFrecency(() => corrupt).scores().size).toBe(0);
    corrupt.setItem(FRECENCY_KEY, '[1,2]');
    expect(createFrecency(() => corrupt).scores().size).toBe(0);

    const throwing: FrecencyStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    const f = createFrecency(() => throwing);
    expect(() => f.record('a')).not.toThrow();
    expect(f.scores().size).toBe(0);
    expect(createFrecency(() => null).scores().size).toBe(0);
  });
});
