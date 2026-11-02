import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { AgentsPane } from './AgentsPane.js';

// Removing a custom agent (plan 004 U6): no sheet; Undo merges it back.

const undo = vi.hoisted(() => ({ offers: [] as { message: string; undo: () => Promise<void> }[] }));
vi.mock('../../../../utils/undoable.js', () => ({
  offerUndo: (o: { message: string; undo: () => Promise<void> }) => { undo.offers.push(o); return { dismiss() {} }; },
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const aider = { id: 'aider', name: 'Aider', command: 'aider', builtin: false };
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  undo.offers.length = 0;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('removes at once with no sheet, then Undo restores the agent, its flags and the default', async () => {
  let config: AppConfig = {
    ...DEFAULT_CONFIG,
    customAgents: [aider],
    agentFlags: { ...DEFAULT_CONFIG.agentFlags, aider: [{ id: 'f', value: '--yes', enabled: true }] },
    defaultAgent: 'aider',
  };
  const onSave = vi.fn(async (p: Partial<AppConfig>) => { config = { ...config, ...p }; rerender(); return config; });
  const rerender = () => root.render(<AgentsPane config={config} onSave={onSave} onSaveFlag={async () => {}} onDeleteFlag={async () => {}} />);
  act(() => rerender());

  const trash = container.querySelector<HTMLButtonElement>('button[aria-label="Remove"]')!;
  await act(async () => { trash.click(); await Promise.resolve(); });
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(config.customAgents).toEqual([]);
  expect(config.agentFlags.aider).toBeUndefined();
  expect(config.defaultAgent).toBe('claude');
  expect(undo.offers[0].message).toBe('Removed Aider');

  await act(async () => { await undo.offers[0].undo(); });
  expect(config.customAgents).toEqual([aider]);
  expect(config.agentFlags.aider).toEqual([{ id: 'f', value: '--yes', enabled: true }]);
  expect(config.defaultAgent).toBe('aider');
});

describe('a failed remove', () => {
  it('offers no Undo', async () => {
    const config: AppConfig = { ...DEFAULT_CONFIG, customAgents: [aider] };
    const onSave = vi.fn(async () => { throw new Error('disk full'); });
    act(() => root.render(<AgentsPane config={config} onSave={onSave} onSaveFlag={async () => {}} onDeleteFlag={async () => {}} />));
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Remove"]')!.click(); await Promise.resolve(); });
    expect(undo.offers).toHaveLength(0);
  });
});
