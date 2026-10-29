/**
 * How often and how recently each palette command was run, for the empty
 * query's Recent group and the ranking boost.
 *
 * Per app profile in localStorage (windows share it, which is the point); a
 * convenience, so any storage failure reads as an empty history and a write
 * failure is dropped. Each id keeps its last 10 runs; the score sums an
 * age-bucket weight per run (Firefox's frecency buckets). Ids that stop
 * resolving are not deleted (a gated command comes back); the palette shows
 * only ids it can run, and the 300-id cap evicts the lowest scores.
 */
export const FRECENCY_KEY = 'argus.palette.frecency.v1';
const MAX_RUNS = 10;
export const MAX_IDS = 300;
const DAY = 86_400_000;

const BUCKETS: readonly [maxAgeMs: number, weight: number][] = [
  [4 * DAY, 100],
  [14 * DAY, 70],
  [31 * DAY, 50],
  [90 * DAY, 30],
];
const OLDEST_WEIGHT = 10;

type Store = Record<string, number[]>;

export interface FrecencyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function runWeight(ageMs: number): number {
  for (const [max, w] of BUCKETS) if (ageMs < max) return w;
  return OLDEST_WEIGHT;
}

function browserStorage(): FrecencyStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createFrecency(
  storage: () => FrecencyStorage | null = browserStorage,
  now: () => number = Date.now,
) {
  const read = (): Store => {
    try {
      const raw = storage()?.getItem(FRECENCY_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Store = {};
      for (const [id, runs] of Object.entries(parsed)) {
        if (Array.isArray(runs)) out[id] = runs.filter((t): t is number => typeof t === 'number');
      }
      return out;
    } catch {
      return {};
    }
  };

  const write = (store: Store) => {
    try {
      storage()?.setItem(FRECENCY_KEY, JSON.stringify(store));
    } catch {
      // Full or blocked storage: history is a convenience.
    }
  };

  const scoreOf = (runs: readonly number[], t: number) =>
    runs.reduce((sum, at) => sum + runWeight(t - at), 0);

  return {
    record(id: string): void {
      const store = read();
      store[id] = [...(store[id] ?? []), now()].slice(-MAX_RUNS);
      const ids = Object.keys(store);
      if (ids.length > MAX_IDS) {
        const t = now();
        ids
          .sort((a, b) => scoreOf(store[a], t) - scoreOf(store[b], t))
          .slice(0, ids.length - MAX_IDS)
          .forEach((drop) => { delete store[drop]; });
      }
      write(store);
    },

    /** Score per id; ids never run are absent (score 0). */
    scores(): Map<string, number> {
      const t = now();
      return new Map(Object.entries(read()).map(([id, runs]) => [id, scoreOf(runs, t)]));
    },
  };
}

export type Frecency = ReturnType<typeof createFrecency>;

/** The app's history (localStorage). */
export const frecency: Frecency = createFrecency();
