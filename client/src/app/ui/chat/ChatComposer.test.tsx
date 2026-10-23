import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionStatus } from '@argus/shared';
import { ChatComposer } from './ChatComposer.js';
import { CYCLE_MODE_KEY } from '../../../utils/chat.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

function render(props: { status?: SessionStatus; permissionMode?: string; model?: string } = {}) {
  const onSend = vi.fn();
  act(() => root.render(<ChatComposer status={props.status ?? 'idle'} onSend={onSend} permissionMode={props.permissionMode} model={props.model} />));
  return onSend;
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
  delete (window as Window & { electronFiles?: unknown }).electronFiles;
});

describe('ChatComposer', () => {
  it('shows the permission mode and model, and cycles the mode with Shift+Tab', () => {
    const onSend = render({ permissionMode: 'auto', model: 'claude-opus-5-5' });
    const mode = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Auto')!;
    expect(container.textContent).toContain('Opus 5.5');
    act(() => mode.click());
    expect(onSend).toHaveBeenCalledWith(CYCLE_MODE_KEY);
  });

  it('does not cycle the mode while a permission prompt is waiting', () => {
    render({ status: 'waiting', permissionMode: 'auto' });
    const mode = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Auto')!;
    expect(mode.disabled).toBe(true);
  });

  it('hides the meta row when nothing is known', () => {
    render();
    expect(container.querySelector('.argus-chat-composer-meta')).toBeNull();
  });

  it('offers "+" only in Electron and inserts the picked paths', () => {
    render();
    expect(container.querySelector('[data-testid="chat-file-input"]')).toBeNull();

    (window as Window & { electronFiles?: unknown }).electronFiles = {
      getPath: (name: string) => (name === 'shot.png' ? '/Users/me/My Shots/shot.png' : undefined),
    };
    render();
    const input = container.querySelector('[data-testid="chat-file-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('textarea')!.value).toBe('"/Users/me/My Shots/shot.png" ');
  });
});
