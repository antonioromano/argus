import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatToolBlock } from '@argus/shared';
import { ChatToolGroup } from './ChatToolGroup.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const bash: ChatToolBlock = { kind: 'tool', id: 't1', name: 'Bash', label: 'List files', status: 'ok', detail: { command: 'ls -la', output: 'a.ts' } };
const edit: ChatToolBlock = {
  kind: 'tool',
  id: 't2',
  name: 'Edit',
  label: 'src/a.ts',
  status: 'blocked',
  detail: { path: '/r/src/a.ts', oldText: 'const a = 1;', newText: 'const a = 2;' },
};

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());

describe('ChatToolGroup', () => {
  it('shows a summary, expands to one row per step, each row to its details', () => {
    act(() => root.render(<ChatToolGroup steps={[bash, edit]} />));
    const head = container.querySelector('.argus-chat-tool-summary');
    expect(head?.textContent).toBe('Ran 1 command, edited 1 file (1 blocked)');
    expect(container.querySelector('[data-testid="chat-tool-step"]')).toBeNull();

    click(head);
    const steps = container.querySelectorAll('[data-testid="chat-tool-step"]');
    expect(Array.from(steps).map((s) => s.querySelector('.argus-chat-tool-head')?.textContent)).toEqual(['List files', 'Editsrc/a.ts']);
    expect(steps[1].getAttribute('data-status')).toBe('blocked');

    click(steps[0].querySelector('button'));
    expect(steps[0].querySelector('.argus-chat-tool-code code')?.textContent).toBe('ls -la');
    expect(steps[0].querySelector('.argus-chat-tool-output')?.textContent).toBe('a.ts');

    click(steps[1].querySelector('button'));
    const diff = steps[1].querySelector('[data-testid="chat-tool-diff"]');
    expect(Array.from(diff!.children).map((r) => r.className)).toEqual(['argus-chat-tool-diff-del', 'argus-chat-tool-diff-add']);
    expect(diff!.textContent).toContain('const a = 2;');
  });

  it('a single call is its own step, no summary', () => {
    act(() => root.render(<ChatToolGroup steps={[bash]} />));
    expect(container.querySelector('.argus-chat-tool-summary')).toBeNull();
    expect(container.querySelector('[data-testid="chat-tool-step"]')?.textContent).toBe('List files');
  });

  it('a lone step left open stays open when the next call turns the row into a group', () => {
    const store = new Set<string>();
    act(() => root.render(<ChatToolGroup steps={[bash]} store={store} />));
    click(container.querySelector('[data-testid="chat-tool-step"] button'));
    act(() => root.render(<ChatToolGroup steps={[bash, edit]} store={store} />));
    const steps = container.querySelectorAll('[data-testid="chat-tool-step"]');
    expect(steps).toHaveLength(2);
    expect(steps[0].classList.contains('is-open')).toBe(true);
  });

  it('shows "No details recorded" for a detail with nothing to render, and keeps id-less steps apart', () => {
    const read = (id: string): ChatToolBlock => ({ kind: 'tool', id, name: 'Read', label: 'a.ts', status: 'pending', detail: { path: '/a.ts' } });
    const store = new Set<string>();
    act(() => root.render(<ChatToolGroup steps={[read(''), read('')]} store={store} />));
    click(container.querySelector('.argus-chat-tool-summary'));
    const steps = container.querySelectorAll('[data-testid="chat-tool-step"]');
    click(steps[0].querySelector('button'));
    expect(steps[0].textContent).toContain('No details recorded.');
    expect(steps[1].classList.contains('is-open')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('keeps what was open in the store across a remount (the virtualizer unmounts offscreen rows)', () => {
    const store = new Set<string>();
    act(() => root.render(<ChatToolGroup steps={[bash, edit]} store={store} />));
    click(container.querySelector('.argus-chat-tool-summary'));
    act(() => root.render(<div />));
    act(() => root.render(<ChatToolGroup steps={[bash, edit]} store={store} />));
    expect(container.querySelectorAll('[data-testid="chat-tool-step"]')).toHaveLength(2);
  });
});
