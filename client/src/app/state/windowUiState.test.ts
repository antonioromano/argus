import { describe, it, expect, beforeEach } from 'vitest';
import { clearWindowUiState, consumeFreshLaunch, loadGroupFilter, persistGroupFilter } from './windowUiState.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('windowUiState', () => {
  it('the group filter round-trips per window and clears with null', () => {
    persistGroupFilter('main', 'g1');
    persistGroupFilter('w2', 'g2');
    expect(loadGroupFilter('main')).toBe('g1');
    expect(loadGroupFilter('w2')).toBe('g2');
    persistGroupFilter('main', null);
    expect(loadGroupFilter('main')).toBeNull();
  });

  it('closing a window drops only its own argus.* keys', () => {
    persistGroupFilter('w2', 'g2');
    localStorage.setItem('argus.appView.w2', '{}');
    localStorage.setItem('argus.appView.w22', '{}');
    localStorage.setItem('argus.appView.main', '{}');
    localStorage.setItem('other.w2', 'x');
    clearWindowUiState('w2');
    expect(localStorage.getItem('argus.appView.w2')).toBeNull();
    expect(localStorage.getItem('argus.groupFilter.w2')).toBeNull();
    expect(localStorage.getItem('argus.appView.w22')).toBe('{}');
    expect(localStorage.getItem('argus.appView.main')).toBe('{}');
    expect(localStorage.getItem('other.w2')).toBe('x');
  });

  it('a launch is fresh once; a reload of the same window is not', () => {
    expect(consumeFreshLaunch()).toBe(true);
    expect(consumeFreshLaunch()).toBe(false);
  });
});
