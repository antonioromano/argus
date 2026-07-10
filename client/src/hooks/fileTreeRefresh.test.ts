import { describe, it, expect } from 'vitest';
import { loadedSubdirs, dirsToRefetch } from './useFileTree.js';
import type { DirectoryEntry } from '@argus/shared';

// Minimal NodeState-shaped map builder for the pure selectors.
type Node = { entry: DirectoryEntry; children?: string[]; expanded: boolean; loading: boolean };
const dir = (path: string, children?: string[]): Node => ({
  entry: { name: path.split('/').pop()!, path, isFile: false, hasChildren: true, ext: '' } as DirectoryEntry,
  children,
  expanded: children !== undefined,
  loading: false,
});
const file = (path: string): Node => ({
  entry: { name: path.split('/').pop()!, path, isFile: true, hasChildren: false, ext: '' } as DirectoryEntry,
  expanded: false,
  loading: false,
});
const mapOf = (...nodes: [string, Node][]) => new Map(nodes) as unknown as Map<string, never>;

const ROOT = '/repo';

describe('loadedSubdirs', () => {
  it('returns expanded/loaded subfolders, excludes root, files, and unopened dirs', () => {
    const nodes = mapOf(
      [ROOT, dir(ROOT, ['/repo/src', '/repo/docs', '/repo/a.ts'])],
      ['/repo/src', dir('/repo/src', ['/repo/src/index.ts'])], // loaded
      ['/repo/docs', dir('/repo/docs')], // never opened (children undefined)
      ['/repo/a.ts', file('/repo/a.ts')],
    );
    expect(loadedSubdirs(nodes as never, ROOT).sort()).toEqual(['/repo/src']);
  });

  it('returns empty when only root is loaded', () => {
    const nodes = mapOf([ROOT, dir(ROOT, [])]);
    expect(loadedSubdirs(nodes as never, ROOT)).toEqual([]);
  });
});

describe('dirsToRefetch', () => {
  const nodes = mapOf(
    [ROOT, dir(ROOT, ['/repo/src'])],
    ['/repo/src', dir('/repo/src', ['/repo/src/index.ts'])],
  );

  it('includes a changed dir that is known', () => {
    expect(dirsToRefetch(nodes as never, ['/repo/src'])).toEqual(['/repo/src']);
  });

  it('includes root when root changes', () => {
    expect(dirsToRefetch(nodes as never, [ROOT])).toEqual([ROOT]);
  });

  it('falls back to a known parent for a new nested dir', () => {
    // /repo/src/newdir is not in the map yet, but its parent /repo/src is.
    expect(dirsToRefetch(nodes as never, ['/repo/src/newdir'])).toEqual(['/repo/src']);
  });

  it('drops changes in an unopened branch (parent also unknown)', () => {
    expect(dirsToRefetch(nodes as never, ['/repo/vendor/x'])).toEqual([]);
  });

  it('dedups multiple changes mapping to the same dir', () => {
    expect(dirsToRefetch(nodes as never, ['/repo/src/a.ts', '/repo/src/b.ts'])).toEqual(['/repo/src']);
  });

  it('ignores unrelated dirs but keeps known ones', () => {
    expect(dirsToRefetch(nodes as never, ['/repo/src', '/repo/vendor/x']).sort()).toEqual(['/repo/src']);
  });
});
