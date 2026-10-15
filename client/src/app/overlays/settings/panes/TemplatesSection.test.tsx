import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type SessionTemplate } from '@argus/shared';

const apiMock = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  launchTemplate: vi.fn(),
  getPathCompletions: vi.fn(async () => [] as string[]),
  pickFolder: vi.fn(async () => null),
}));
vi.mock('../../../../services/api.js', async (orig) => ({
  ...(await orig<typeof import('../../../../services/api.js')>()),
  api: apiMock,
}));
const toasts = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('../../../../components/primitives/index.js', async (orig) => ({
  ...(await orig<typeof import('../../../../components/primitives/index.js')>()),
  pushToast: toasts.push,
}));

import { TemplatesSection } from './TemplatesSection.js';
import { LaunchersPane } from './LaunchersPane.js';
import { TemplateApiError } from '../../../../services/api.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const T: SessionTemplate = {
  id: 't1', name: 'Trio', createdAt: '', updatedAt: '',
  specs: [
    { agent: 'claude', folder: '/Users/me/api', name: 'api', worktreeBranch: 'feat/api', prompt: 'build the endpoint' },
    { agent: 'codex', folder: '/Users/me/web' },
  ],
};

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(apiMock)) f.mockReset();
  apiMock.getPathCompletions.mockResolvedValue([]);
  apiMock.listTemplates.mockResolvedValue([T]);
  toasts.push.mockClear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
async function render() {
  await act(async () => { root.render(<TemplatesSection config={{ ...DEFAULT_CONFIG }} />); });
  await flush();
}
const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
const btn = (testid: string, i = 0) => $$(`[data-testid="${testid}"] button`)[i]!;
/** Set a React-controlled input/textarea value. */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('TemplatesSection', () => {
  it('lists saved templates', async () => {
    await render();
    expect($$('[data-testid="template-row"]')).toHaveLength(1);
    expect(container.textContent).toContain('Trio');
    expect(container.textContent).toContain('2 sessions · api, web');
  });

  it('editor: add and remove rows within 1–8, then saves the trimmed request', async () => {
    apiMock.listTemplates.mockResolvedValue([]);
    apiMock.createTemplate.mockResolvedValue({ ...T, id: 'new' });
    await render();
    expect(container.textContent).toContain('No templates yet');
    await click(btn('template-new'));
    expect($$('[data-testid="template-spec"]')).toHaveLength(1);
    // The only row can't be removed.
    expect((btn('template-spec-remove') as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 9; i++) await click(btn('template-spec-add'));
    expect($$('[data-testid="template-spec"]')).toHaveLength(8);
    expect((btn('template-spec-add') as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 6; i++) await click(btn('template-spec-remove', 0));
    expect($$('[data-testid="template-spec"]')).toHaveLength(2);

    // Save stays disabled until the name and every folder are filled.
    expect((btn('template-save') as HTMLButtonElement).disabled).toBe(true);
    const editor = $('[data-testid="template-editor"]');
    type(editor.querySelector('input') as HTMLInputElement, '  Duo  ');
    const rows = $$('[data-testid="template-spec"]');
    const inputs = (r: HTMLElement) => Array.from(r.querySelectorAll('input')) as HTMLInputElement[];
    type(inputs(rows[0]!)[0]!, ' /Users/me/api ');
    type(inputs(rows[0]!)[2]!, ' feat/x ');
    type(rows[0]!.querySelector('textarea')!, 'go');
    type(inputs(rows[1]!)[0]!, '/Users/me/web');
    await act(async () => {
      const sel = rows[1]!.querySelector('select') as HTMLSelectElement;
      sel.value = 'codex';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((btn('template-save') as HTMLButtonElement).disabled).toBe(false);
    await click(btn('template-save'));
    expect(apiMock.createTemplate).toHaveBeenCalledWith({
      name: 'Duo',
      specs: [
        { agent: 'claude', folder: '/Users/me/api', worktreeBranch: 'feat/x', prompt: 'go' },
        { agent: 'codex', folder: '/Users/me/web' },
      ],
    });
    expect($('[data-testid="template-editor"]')).toBeNull();
  });

  it('editor: shows server spec errors on their rows and stays open', async () => {
    apiMock.updateTemplate.mockRejectedValue(new TemplateApiError(400, 'Some sessions are invalid', [{ index: 1, error: 'Folder does not exist: /Users/me/web' }]));
    await render();
    await click(btn('template-edit'));
    expect($$('[data-testid="template-spec"]')).toHaveLength(2);
    await click(btn('template-save'));
    expect(apiMock.updateTemplate).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'Trio' }));
    expect($('[data-testid="template-error"]').textContent).toContain('Some sessions are invalid');
    const rows = $$('[data-testid="template-spec"]');
    expect(rows[0]!.textContent).not.toContain('Folder does not exist');
    expect(rows[1]!.textContent).toContain('Folder does not exist');
  });

  it('launch: an in-page confirm lists what will be created, then per-spec results', async () => {
    apiMock.launchTemplate.mockResolvedValue({
      group: { id: 'g', name: 'Trio', color: 'teal', collapsed: false, sessionIds: ['s1'] },
      results: [
        { index: 0, ok: true, session: { id: 's1', name: 'api' } },
        { index: 1, ok: false, error: 'Agent "codex" is not installed' },
      ],
    });
    await render();
    await click(btn('template-launch'));
    const confirm = $('[data-testid="template-launch-confirm"]');
    expect(confirm.textContent).toContain('Start 2 shells into a new group “Trio”');
    expect(confirm.textContent).toContain('api — claude @ /Users/me/api · new worktree feat/api · prompt “build the endpoint”');
    expect(confirm.textContent).toContain('web — codex @ /Users/me/web');
    expect(apiMock.launchTemplate).not.toHaveBeenCalled();

    await click(btn('template-launch-go'));
    expect(apiMock.launchTemplate).toHaveBeenCalledWith('t1', expect.any(String));
    expect($('[data-testid="template-launch-confirm"]')).toBeNull();
    const results = $('[data-testid="template-results"]');
    expect(results.textContent).toContain('Started into group “Trio”');
    expect($('[data-testid="template-result-ok"]').textContent).toContain('api');
    expect($('[data-testid="template-result-error"]').textContent).toContain('web: Agent "codex" is not installed');
  });

  it('launch: a failed request keeps the confirm open with the error', async () => {
    apiMock.launchTemplate.mockRejectedValue(new Error('Template not found'));
    await render();
    await click(btn('template-launch'));
    await click(btn('template-launch-go'));
    expect($('[data-testid="template-launch-confirm"]').textContent).toContain('Template not found');
    expect($('[data-testid="template-results"]')).toBeNull();
  });

  it('delete asks inline first', async () => {
    apiMock.deleteTemplate.mockResolvedValue(undefined);
    await render();
    await click(btn('template-delete'));
    expect(apiMock.deleteTemplate).not.toHaveBeenCalled();
    await click(btn('template-delete-confirm'));
    expect(apiMock.deleteTemplate).toHaveBeenCalledWith('t1');
  });
});

describe('LaunchersPane templates gate', () => {
  it('renders nothing and fetches nothing while the flag is off', async () => {
    await act(async () => { root.render(<LaunchersPane config={{ ...DEFAULT_CONFIG }} onSave={vi.fn() as never} />); });
    await flush();
    expect(container.textContent).not.toContain('Templates');
    expect(apiMock.listTemplates).not.toHaveBeenCalled();
  });

  it('shows the Templates section when the flag is on', async () => {
    await act(async () => { root.render(<LaunchersPane config={{ ...DEFAULT_CONFIG, betaSessionTemplates: true }} onSave={vi.fn() as never} />); });
    await flush();
    expect(container.textContent).toContain('Templates');
    expect(apiMock.listTemplates).toHaveBeenCalled();
  });
});
