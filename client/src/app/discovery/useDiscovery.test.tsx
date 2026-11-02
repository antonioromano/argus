import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { useDiscovery, type DiscoveryApi } from './useDiscovery.js';
import { markUsed } from './discoveryState.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
const results: DiscoveryApi[] = [];
const latest = () => results[results.length - 1];

function Harness(props: Parameters<typeof useDiscovery>[0]) {
  results.push(useDiscovery(props));
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('useDiscovery', () => {
  it('serializes quick patches so neither is lost, and writes the whole object', async () => {
    const config = structuredClone(DEFAULT_CONFIG) as AppConfig;
    const updateConfig = vi.fn(async (p: Partial<AppConfig>) => ({ ...config, ...p }));
    act(() => root.render(<Harness config={config} updateConfig={updateConfig} isMainWindow />));
    await act(async () => {
      void latest().patch((s) => markUsed(s, 'inbox'));
      await latest().patch((s) => markUsed(s, 'broadcast'));
    });
    expect(updateConfig).toHaveBeenCalledTimes(2);
    const last = updateConfig.mock.calls[1][0].discovery!;
    expect(last.used).toEqual(['inbox', 'broadcast']);
    expect(Object.keys(last).sort()).toEqual(Object.keys(DEFAULT_CONFIG.discovery!).sort());
  });

  it('skips a write that changes nothing', async () => {
    const config = { ...structuredClone(DEFAULT_CONFIG), discovery: { ...DEFAULT_CONFIG.discovery!, used: ['inbox'] } } as AppConfig;
    const updateConfig = vi.fn(async () => config);
    act(() => root.render(<Harness config={config} updateConfig={updateConfig} isMainWindow />));
    await act(async () => { await latest().patch((s) => markUsed(s, 'inbox')); });
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('never writes from a secondary window or before config loads', async () => {
    const updateConfig = vi.fn(async () => DEFAULT_CONFIG);
    act(() => root.render(<Harness config={structuredClone(DEFAULT_CONFIG)} updateConfig={updateConfig} isMainWindow={false} />));
    await act(async () => { await latest().patch((s) => markUsed(s, 'inbox')); });
    act(() => root.render(<Harness config={null} updateConfig={updateConfig} isMainWindow />));
    await act(async () => { await latest().patch((s) => markUsed(s, 'inbox')); });
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
