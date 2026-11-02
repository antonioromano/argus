import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { ImportPreviewSheet } from './ImportPreviewSheet.js';
import { SettingsOverlay } from '../SettingsOverlay.js';
import { diffImport } from '../../../settings-backup/diffImport.js';
import { parseSettingsFile } from '../../../settings-backup/parseSettingsFile.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

function planFor(file: Record<string, unknown>) {
  const r = parseSettingsFile(JSON.stringify({ kind: 'argus-settings', version: 1, ...file }));
  if (!r.ok) throw new Error(r.error);
  return diffImport(r.value, { config: DEFAULT_CONFIG, templates: [], launchers: [] });
}

const FULL = {
  preferences: { showClock: true, ptyBackend: 'tmux', autoApprovalEnabled: true },
  customAgents: [{ id: 'aider', name: 'Aider', command: 'aider' }],
  launchers: [{ id: 'api', label: 'API', request: { agent: 'claude', folder: '/x', flags: [] } }],
};

function show(file: Record<string, unknown>, onApply = vi.fn()) {
  act(() => {
    root.render(<ImportPreviewSheet plan={planFor(file)} applying={false} onApply={onApply} onCancel={() => {}} />);
  });
  return onApply;
}

const item = (key: string) => container.querySelector<HTMLElement>(`[data-import-item="${key}"] [role="checkbox"]`)!;
const section = (id: string) => container.querySelector<HTMLElement>(`[data-import-section="${id}"]`);
const applyButton = () => Array.from(container.ownerDocument.querySelectorAll<HTMLButtonElement>('button'))
  .find((b) => b.textContent?.startsWith('Import '))!;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.electronSettings;
});

describe('ImportPreviewSheet', () => {
  it('starts sensitive items unchecked and the rest checked', () => {
    show(FULL);
    expect(item('preferences:showClock').getAttribute('aria-checked')).toBe('true');
    expect(item('launchers:api').getAttribute('aria-checked')).toBe('true');
    for (const key of ['preferences:ptyBackend', 'preferences:autoApprovalEnabled', 'agents:aider']) {
      expect(item(key).getAttribute('aria-checked'), key).toBe('false');
    }
    expect(container.textContent).toContain('2 of 5 selected');
  });

  it('shows the relaunch note for a backend change', () => {
    show(FULL);
    expect(container.querySelector('[data-import-item="preferences:ptyBackend"]')?.textContent).toMatch(/relaunch/i);
  });

  it('drops an unchecked section from the apply plan', () => {
    const onApply = show(FULL);
    const sectionBox = section('launchers')!.querySelector<HTMLElement>('[role="checkbox"]')!;
    act(() => { sectionBox.click(); });
    act(() => { applyButton().click(); });
    expect([...onApply.mock.calls[0][0]]).toEqual(['preferences:showClock']);
  });

  it('hides the sections a preferences-only file does not have', () => {
    show({ preferences: { showClock: true } });
    expect(section('preferences')).not.toBeNull();
    for (const id of ['agents', 'flags', 'templates', 'launchers']) expect(section(id), id).toBeNull();
  });

  it('disables Import with nothing selected', () => {
    show({ preferences: { autoApprovalEnabled: true } });
    expect(applyButton().disabled).toBe(true);
    act(() => { item('preferences:autoApprovalEnabled').click(); });
    expect(applyButton().disabled).toBe(false);
  });

  it('lists blocked and unrecognized entries under Not imported', () => {
    show({ preferences: { windowMaterial: 'solid' }, customAgents: [{ id: 'x', name: 'X', command: 'x; rm -rf /' }] });
    const ignored = section('ignored')!.textContent!;
    expect(ignored).toContain('unsafe command');
    expect(ignored).toContain('Not recognized: windowMaterial');
  });
});

describe('Settings footer Export / Import', () => {
  const renderOverlay = () => act(() => {
    root.render(
      <SettingsOverlay
        config={DEFAULT_CONFIG}
        onClose={() => {}}
        onSave={async () => DEFAULT_CONFIG}
        onSaveFlag={async () => {}}
        onDeleteFlag={async () => {}}
        ngrokStatus={null}
        ngrokLoading={false}
        ngrokError={null}
        onNgrokStart={() => {}}
        onNgrokStop={() => {}}
      />,
    );
  });
  const labels = () => Array.from(container.querySelectorAll('button')).map((b) => b.textContent);

  it('hides the buttons without the Electron bridge', () => {
    renderOverlay();
    expect(labels()).not.toContain('Export…');
    expect(labels()).not.toContain('Import…');
  });

  it('shows them with the bridge', () => {
    window.electronSettings = {
      saveFile: vi.fn(), openFile: vi.fn(), backup: vi.fn(), reveal: vi.fn(),
    };
    renderOverlay();
    expect(labels()).toContain('Export…');
    expect(labels()).toContain('Import…');
  });

  it('backs the current settings up before the first write, then applies the selection', async () => {
    const order: string[] = [];
    window.electronSettings = {
      saveFile: vi.fn(),
      openFile: vi.fn(async () => ({ ok: true as const, text: JSON.stringify({ kind: 'argus-settings', version: 1, preferences: { showClock: true } }) })),
      backup: vi.fn(async (text: string) => { order.push(`backup:${JSON.parse(text).preferences.showClock}`); return { ok: true as const, path: '/b.json' }; }),
      reveal: vi.fn(),
    };
    const onSave = vi.fn(async (p: Partial<typeof DEFAULT_CONFIG>) => { order.push(`save:${JSON.stringify(p)}`); return { ...DEFAULT_CONFIG, ...p }; });
    act(() => {
      root.render(
        <SettingsOverlay
          config={DEFAULT_CONFIG}
          onClose={() => {}}
          onSave={onSave}
          onSaveFlag={async () => {}}
          onDeleteFlag={async () => {}}
          ngrokStatus={null}
          ngrokLoading={false}
          ngrokError={null}
          onNgrokStart={() => {}}
          onNgrokStop={() => {}}
          action={{ kind: 'import' }}
        />,
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.ownerDocument.body.textContent).toContain('1 of 1 selected');
    await act(async () => { applyButton().click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(order).toEqual(['backup:false', 'save:{"showClock":true}']);
  });
});
