import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ActivityEvent, SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { ActivityPanel } from './ActivityPanel.js';
import { relativeTime } from './activityFormat.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const getSessionActivity = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: { getSessionActivity: (...a: unknown[]) => getSessionActivity(...a) },
}));

type Handler = (p: { sessionId: string; event: ActivityEvent }) => void;
function fakeSocket() {
  const handlers = new Set<Handler>();
  return {
    on: (_e: string, h: Handler) => { handlers.add(h); },
    off: (_e: string, h: Handler) => { handlers.delete(h); },
    emit: (p: { sessionId: string; event: ActivityEvent }) => handlers.forEach((h) => h(p)),
  };
}

const NOW = Date.now();
const EVENTS: ActivityEvent[] = [
  { id: 1, at: NOW - 120_000, type: 'prompt', summary: 'fix the tests' },
  { id: 2, at: NOW - 60_000, type: 'tool', tool: 'Bash', summary: 'npm test' },
  { id: 3, at: NOW - 30_000, type: 'tool', tool: 'Edit', summary: '/repo/a.ts', filePath: '/repo/a.ts' },
  { id: 4, at: NOW - 1_000, type: 'stop', summary: 'Stopped, waiting for input' },
];

const session: SessionInfo = {
  id: 's1', name: 'x', folderPath: '/repo', status: 'idle', createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
};

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  getSessionActivity.mockReset().mockResolvedValue({ events: EVENTS });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(socket = fakeSocket(), onOpenFile = vi.fn()) {
  await act(async () => {
    root.render(<ActivityPanel session={session} socket={socket as unknown as Socket} onOpenFile={onOpenFile} />);
  });
  return { socket, onOpenFile };
}
const rows = () => Array.from(container.querySelectorAll('[role="listitem"]')) as HTMLElement[];

describe('ActivityPanel', () => {
  it('renders entries newest first with relative times', async () => {
    await render();
    expect(getSessionActivity).toHaveBeenCalledWith('s1', expect.anything());
    expect(rows().map((r) => r.dataset.type)).toEqual(['stop', 'tool', 'tool', 'prompt']);
    expect(rows()[1]!.textContent).toContain('Edit');
    expect(rows()[1]!.textContent).toContain('/repo/a.ts');
    expect(rows()[2]!.textContent).toContain('1m');
  });

  it('filters by type', async () => {
    await render();
    const select = container.querySelector('select[aria-label="Filter activity by type"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'tool';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(rows().map((r) => r.dataset.type)).toEqual(['tool', 'tool']);
    await act(async () => {
      select.value = 'compact';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('Nothing of this type yet');
  });

  it('prepends live events for its own session only', async () => {
    const { socket } = await render();
    await act(async () => {
      socket.emit({ sessionId: 'other', event: { id: 9, at: NOW, type: 'tool', tool: 'Read', summary: 'nope' } });
      socket.emit({ sessionId: 's1', event: { id: 5, at: NOW, type: 'compact', summary: 'Auto-compact' } });
    });
    expect(rows()).toHaveLength(5);
    expect(rows()[0]!.dataset.type).toBe('compact');
  });

  it('opens a file entry on click; other rows are not clickable', async () => {
    const { onOpenFile } = await render();
    act(() => rows()[1]!.click());
    expect(onOpenFile).toHaveBeenCalledWith('/repo/a.ts');
    act(() => rows()[0]!.click());
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(rows()[0]!.dataset.clickable).toBeUndefined();
  });

  it('shows an empty state', async () => {
    getSessionActivity.mockResolvedValue({ events: [] });
    await render();
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('No activity yet');
  });
});

describe('relativeTime', () => {
  it('formats compact relative times', () => {
    expect(relativeTime(1000, 2000)).toBe('now');
    expect(relativeTime(0, 42_000)).toBe('42s');
    expect(relativeTime(0, 5 * 60_000)).toBe('5m');
    expect(relativeTime(0, 3 * 3_600_000)).toBe('3h');
    expect(relativeTime(0, 2 * 86_400_000)).toBe('2d');
  });
});
