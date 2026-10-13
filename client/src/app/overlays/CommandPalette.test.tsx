import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { CommandPalette } from './CommandPalette.js';
import { filterCommands, type PaletteCommand } from './paletteCommands.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../../services/api.js', () => ({ api: { searchFiles: vi.fn(async () => ({ results: [] })), getFileContent: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {}; // jsdom has no layout
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const session: SessionInfo = { id: 's1', name: 'api', folderPath: '/r/api', status: 'idle', createdAt: '', agentType: 'claude', flags: [] };
const cmd = (id: string, label: string, run = vi.fn()): PaletteCommand => ({ id, label, run });
const key = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

describe('filterCommands', () => {
  it('matches label and keywords, case-insensitive', () => {
    const list = [cmd('a', 'Waiting inbox'), { ...cmd('b', 'Broadcast input…'), keywords: 'send many' }];
    expect(filterCommands(list, 'INBOX').map((c) => c.id)).toEqual(['a']);
    expect(filterCommands(list, 'send').map((c) => c.id)).toEqual(['b']);
    expect(filterCommands(list, '').length).toBe(2);
  });
});

describe('CommandPalette commands', () => {
  it('lists commands after sessions and runs the selected one on Enter', () => {
    const run = vi.fn();
    act(() => root.render(
      <CommandPalette
        sessions={[session]}
        initialScopeSessionId={null}
        onClose={() => {}}
        onJumpSession={() => {}}
        onOpenInExplorer={() => {}}
        onOpenInDiff={() => {}}
        commands={[cmd('inbox', 'Waiting inbox', run)]}
      />,
    ));
    const labels = [...container.querySelectorAll('.eyebrow')].map((e) => e.textContent);
    expect(labels).toContain('COMMANDS');
    key('ArrowDown'); // session row → command row
    key('Enter');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
