import { describe, it, expect } from 'vitest';
import { deriveSurfaceState, type SurfaceStateInput } from './surfaceState.js';

describe('deriveSurfaceState', () => {
  const err = new Error('x');
  it.each([
    // No data yet
    [{ data: undefined, loading: true }, 'loading'],
    [{ data: null, loading: false }, 'loading'],
    [{ data: undefined, error: err }, 'error'],
    [{ data: undefined, error: err, loading: true }, 'loading'],
    // Empty
    [{ data: [], loading: true }, 'loading'],
    [{ data: [], loading: false }, 'empty'],
    [{ data: [], error: err }, 'error'],
    // Data
    [{ data: [1], loading: false }, 'ready'],
    [{ data: [1], loading: true }, 'ready'],
    [{ data: [1], error: err }, 'stale'],
    [{ data: [1], error: err, loading: true }, 'stale'],
  ] as const)('%o → %s', (input, expected) => {
    expect(deriveSurfaceState(input as SurfaceStateInput<unknown>)).toBe(expected);
  });

  it('isEmpty decides emptiness for non-array data', () => {
    expect(deriveSurfaceState({ data: { rows: [] }, isEmpty: (d) => d.rows.length === 0 })).toBe('empty');
    expect(deriveSurfaceState({ data: { rows: [1] }, isEmpty: (d) => d.rows.length === 0 })).toBe('ready');
    expect(deriveSurfaceState({ data: '', isEmpty: (d) => d === '' })).toBe('empty');
  });

  it('a non-array value without isEmpty is ready', () => {
    expect(deriveSurfaceState({ data: { a: 1 } })).toBe('ready');
    expect(deriveSurfaceState({ data: 0 })).toBe('ready');
  });

  it('an empty result whose refresh failed is an error, not stale (nothing to keep)', () => {
    expect(deriveSurfaceState({ data: [], error: err })).toBe('error');
  });
});
