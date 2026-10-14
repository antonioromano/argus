import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig, type AutoApprovalFolderState } from '@argus/shared';
import { AutoApprovalPane } from './AutoApprovalPane.js';

const mocks = vi.hoisted(() => ({
  getFolders: vi.fn(),
  getRules: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
  push: vi.fn(),
}));
vi.mock('../../../../services/api.js', () => ({
  api: {
    getAutoApprovalFolders: mocks.getFolders,
    getAutoApprovalRules: mocks.getRules,
    addAutoApprovalRule: mocks.addRule,
    removeAutoApprovalRule: mocks.removeRule,
  },
}));
vi.mock('../../../../components/primitives/index.js', async (orig) => ({
  ...(await orig<typeof import('../../../../components/primitives/index.js')>()),
  pushToast: mocks.push,
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const FOLDER = '/Users/me/proj';
const STATE: AutoApprovalFolderState = {
  folder: FOLDER,
  rules: [{ id: 'r1', tool: 'Bash', bashPrefix: 'npm test', createdAt: '2026-10-14T00:00:00Z' }],
  audit: [{ at: '2026-10-14T10:00:00Z', sessionId: 's1', tool: 'Bash', ruleId: 'r1', summary: 'npm test -- --watch' }],
};

let container: HTMLDivElement; let root: Root;
let onSave: ReturnType<typeof vi.fn>;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.getFolders.mockReset().mockResolvedValue([{ folder: FOLDER, ruleCount: 1, hasSession: true }]);
  mocks.getRules.mockReset().mockResolvedValue(STATE);
  mocks.addRule.mockReset().mockResolvedValue({ id: 'r2', tool: 'Read', pathGlob: 'src/**', createdAt: 'x' });
  mocks.removeRule.mockReset().mockResolvedValue(undefined);
  mocks.push.mockReset();
  onSave = vi.fn().mockResolvedValue(DEFAULT_CONFIG);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(config: Partial<AppConfig> = {}) {
  await act(async () => {
    root.render(<AutoApprovalPane config={{ ...DEFAULT_CONFIG, ...config }} onSave={onSave as never} />);
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => {
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};
function type(value: string) {
  const input = container.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('AutoApprovalPane', () => {
  it('lists the folder rules and recent auto-approvals', async () => {
    await render();
    expect(mocks.getRules).toHaveBeenCalledWith(FOLDER);
    expect(container.querySelectorAll('[data-testid="aa-rule"]')).toHaveLength(1);
    expect(container.textContent).toContain('Bash: npm test');
    expect(container.querySelectorAll('[data-testid="aa-audit"]')).toHaveLength(1);
    expect(container.textContent).toContain('npm test -- --watch');
  });

  it('turning the feature on needs an in-page confirmation; off saves at once', async () => {
    await render();
    // Toggle renders a <label><span onClick> — the first span inside the first label.
    const toggle = container.querySelector('label > span');
    await click(toggle!);
    expect(onSave).not.toHaveBeenCalled();
    await click(button('Cancel'));
    expect(onSave).not.toHaveBeenCalled();
    await click(toggle!);
    await click(button('Turn on'));
    expect(onSave).toHaveBeenCalledWith({ autoApprovalEnabled: true });
  });

  it('removing a rule asks first', async () => {
    await render();
    await click(button('Remove…'));
    expect(mocks.removeRule).not.toHaveBeenCalled();
    await click(button('Remove'));
    expect(mocks.removeRule).toHaveBeenCalledWith(FOLDER, 'r1');
  });

  it('adds a file rule with the chosen tool and glob', async () => {
    await render();
    await click([...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Read'));
    type('src/**');
    await click(button('Add rule'));
    expect(mocks.addRule).toHaveBeenCalledWith({ folder: FOLDER, tool: 'Read', pathGlob: 'src/**' });
  });

  it('shows the server reason when a rule is rejected', async () => {
    mocks.addRule.mockRejectedValue(new Error('prefix may not contain shell operators'));
    await render();
    type('git status; rm');
    await click(button('Add rule'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('shell operators');
  });

  it('empty state with no session folders', async () => {
    mocks.getFolders.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain('No session folders yet');
    expect(mocks.getRules).not.toHaveBeenCalled();
  });
});
