import { describe, it, expect, vi } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { viewSource } from './view.js';
import { stubContext } from './testContext.js';

const s = { id: 's1', name: 'api', folderPath: '/r/x/api', status: 'exited', createdAt: '', agentType: 'claude', flags: [] } as SessionInfo;

describe('viewSource', () => {
  it('gates Launch template on the beta flag', () => {
    expect(viewSource(stubContext()).find((c) => c.id === 'view:launch-template')!.when).toBe(false);
    expect(viewSource(stubContext({ templatesEnabled: true })).find((c) => c.id === 'view:launch-template')!.when).toBe(true);
  });

  it('adds one resume row per resumable session', () => {
    const resume = vi.fn();
    const row = viewSource(stubContext({ resumable: [s], resume })).find((c) => c.id === 'resume:s1')!;
    expect(row.title).toBe('Resume conversation: api');
    expect(row.hint).toBe('x/api');
    row.run();
    expect(resume).toHaveBeenCalledWith(s);
  });
});
