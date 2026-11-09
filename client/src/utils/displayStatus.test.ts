import { describe, it, expect } from 'vitest';
import { displayStatus, sortStatus } from './displayStatus.js';

describe('displayStatus', () => {
  it('idle with 2 running agents → agents', () => {
    expect(displayStatus({ status: 'idle', agentsRunning: 2 })).toBe('agents');
  });
  it('idle with 0 → idle', () => {
    expect(displayStatus({ status: 'idle', agentsRunning: 0 })).toBe('idle');
    expect(displayStatus({ status: 'idle' })).toBe('idle');
  });
  it('running with agents → running', () => {
    expect(displayStatus({ status: 'running', agentsRunning: 3 })).toBe('running');
  });
  it('waiting with agents → waiting', () => {
    expect(displayStatus({ status: 'waiting', agentsRunning: 1 })).toBe('waiting');
  });
});

describe('sortStatus', () => {
  it("maps 'agents' to 'running'", () => {
    expect(sortStatus('agents')).toBe('running');
  });
  it('is identity for detector statuses', () => {
    expect(sortStatus('idle')).toBe('idle');
    expect(sortStatus('waiting')).toBe('waiting');
  });
});
