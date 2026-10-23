import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionStatus } from '@argus/shared';
import { ChatComposer } from './ChatComposer.js';
import { CHAT_ENTER_DELAY_MS } from '../../../utils/chat.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

interface Props {
  status?: SessionStatus;
  permissionMode?: string;
  model?: string;
  onSetMode?: (mode: string) => Promise<boolean>;
}

function render(props: Props = {}) {
  const onSend = vi.fn();
  act(() =>
    root.render(
      <ChatComposer
        status={props.status ?? 'idle'}
        onSend={onSend}
        permissionMode={props.permissionMode}
        model={props.model}
        onSetMode={props.onSetMode}
      />,
    ),
  );
  return onSend;
}

const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;
const menuItem = (text: string) =>
  Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent?.startsWith(text)) as HTMLButtonElement | undefined;

function pick(name: string, path: string, type = 'image/png') {
  (window as Window & { electronFiles?: unknown }).electronFiles = { getPath: (n: string) => (n === name ? path : undefined) };
  return new File(['x'], name, { type });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  delete (window as Window & { electronFiles?: unknown }).electronFiles;
  vi.useRealTimers();
});

describe('ChatComposer — mode and model', () => {
  it('picks a permission mode from the menu', async () => {
    const onSetMode = vi.fn(async () => true);
    render({ permissionMode: 'auto', onSetMode });
    act(() => button('Auto')!.click());
    expect(menuItem('Auto')?.textContent).toContain('✓');
    await act(async () => menuItem('Plan')!.click());
    expect(onSetMode).toHaveBeenCalledWith('plan');
  });

  it('cannot switch mode while a permission prompt is waiting', () => {
    render({ status: 'waiting', permissionMode: 'auto', onSetMode: async () => true });
    expect(button('Auto')!.disabled).toBe(true);
  });

  it('switches model with /model and shows the pick until the next turn', () => {
    vi.useFakeTimers();
    const onSend = render({ model: 'claude-opus-5-5' });
    act(() => button('Opus 5.5')!.click());
    act(() => menuItem('Sonnet 5.5')!.click());
    expect(onSend).toHaveBeenCalledWith('/model claude-sonnet-5-5');
    act(() => { vi.advanceTimersByTime(CHAT_ENTER_DELAY_MS); });
    expect(onSend).toHaveBeenLastCalledWith('\r');
    expect(button('Sonnet 5.5')).toBeDefined();
  });
});

describe('ChatComposer — attachments', () => {
  it('offers "+" only in Electron', () => {
    render();
    expect(container.querySelector('[data-testid="chat-file-input"]')).toBeNull();
  });

  it('previews picked files and sends their paths ahead of the text', () => {
    vi.useFakeTimers();
    const file = pick('shot.png', '/Users/me/My Shots/shot.png');
    const onSend = render();
    const input = container.querySelector('[data-testid="chat-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });

    const thumb = container.querySelector('.argus-chat-attachment img') as HTMLImageElement;
    expect(thumb.getAttribute('src')).toBe('blob:preview');
    expect(container.querySelector('textarea')!.value).toBe('');

    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    act(() => send.click());
    expect(onSend).toHaveBeenCalledWith('"/Users/me/My Shots/shot.png"');
    expect(container.querySelector('.argus-chat-attachment')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('shows non-image files by name and removes them', () => {
    const file = pick('notes.md', '/tmp/notes.md', 'text/markdown');
    render();
    const input = container.querySelector('[data-testid="chat-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('.argus-chat-attachment-file')?.textContent).toBe('notes.md');
    act(() => (container.querySelector('button[aria-label="Remove notes.md"]') as HTMLButtonElement).click());
    expect(container.querySelector('.argus-chat-attachment')).toBeNull();
  });
});
