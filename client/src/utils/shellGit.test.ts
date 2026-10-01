import { describe, it, expect } from 'vitest';
import { describeShellGit } from './shellGit.js';

describe('describeShellGit', () => {
  it('spells out push/pull/changes', () => {
    expect(describeShellGit('/r', { root: '/r', branch: 'main', detached: false, ahead: 2, behind: 1, changes: 1 }))
      .toBe('/r · on main · 2 commits to push · 1 commit to pull · 1 changed file');
  });

  it('reads a synced clean repo, no upstream, and a detached HEAD', () => {
    expect(describeShellGit('/r', { root: '/r', branch: 'main', detached: false, ahead: 0, behind: 0, changes: 0 }))
      .toBe('/r · on main · in sync with upstream · clean');
    expect(describeShellGit('/r', { root: '/r', branch: 'abc1234', detached: true, ahead: null, behind: null, changes: 0 }))
      .toBe('/r · detached at abc1234 · no upstream · clean');
  });
});
