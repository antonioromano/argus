import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionStatus } from '@argus/shared';
import { ChatComposer } from './ChatComposer.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

interface Props {
  status?: SessionStatus;
  permissionMode?: string;
  model?: string;
  modelSet?: string;
  onUploadImage?: (file: File) => Promise<string>;
  onSetMode?: (mode: string) => Promise<boolean>;
}

function render(props: Props = {}) {
  const onSubmit = vi.fn();
  act(() =>
    root.render(
      <ChatComposer
        status={props.status ?? 'idle'}
        onSubmit={onSubmit}
        permissionMode={props.permissionMode}
        model={props.model}
        modelSet={props.modelSet}
        onUploadImage={props.onUploadImage}
        onSetMode={props.onSetMode}
      />,
    ),
  );
  return onSubmit;
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
    const onSubmit = render({ model: 'claude-opus-5-5' });
    act(() => button('Opus 5.5')!.click());
    act(() => menuItem('Sonnet 5.5')!.click());
    expect(onSubmit).toHaveBeenCalledWith('/model claude-sonnet-5-5');
    expect(button('Sonnet 5.5')).toBeDefined();
    // Quick switch back: sent again, and the label follows.
    act(() => button('Sonnet 5.5')!.click());
    act(() => menuItem('Opus 5.5')!.click());
    expect(onSubmit).toHaveBeenLastCalledWith('/model claude-opus-5-5');
    expect(button('Opus 5.5')).toBeDefined();
  });
});

describe('ChatComposer — model label', () => {
  it('prefers the model set with /model over the last turn, and confirms a pick', () => {
    render({ model: 'claude-opus-5-5', modelSet: 'Sonnet 5.5' });
    expect(button('Sonnet 5.5')).toBeDefined();
    act(() => button('Sonnet 5.5')!.click());
    expect(menuItem('Sonnet 5.5')?.textContent).toContain('✓');
    act(() => menuItem('Opus 5.5')!.click());
    expect(button('Opus 5.5')).toBeDefined();
    // The transcript reports something else: the truth wins over the optimistic pick.
    render({ model: 'claude-opus-5-5', modelSet: 'Haiku 5.5' });
    expect(button('Haiku 5.5')).toBeDefined();
  });
});

describe('ChatComposer — attachments', () => {
  it('offers "+" only in Electron', () => {
    render();
    expect(container.querySelector('[data-testid="chat-file-input"]')).toBeNull();
  });

  it('previews picked files and sends their paths ahead of the text', () => {
    const file = pick('shot.png', '/Users/me/My Shots/shot.png');
    const onSubmit = render();
    const input = container.querySelector('[data-testid="chat-file-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });

    const thumb = container.querySelector('.argus-chat-attachment img') as HTMLImageElement;
    expect(thumb.getAttribute('src')).toBe('blob:preview');
    expect(container.querySelector('textarea')!.value).toBe('');

    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    act(() => send.click());
    expect(onSubmit).toHaveBeenCalledWith('"/Users/me/My Shots/shot.png"');
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

describe('ChatComposer — pasted images', () => {
  function paste(files: File[]) {
    const box = container.querySelector('textarea')!;
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { files, getData: () => '' };
    act(() => { box.dispatchEvent(event); });
    return event;
  }

  it('uploads a clipboard screenshot, previews it, and sends its saved path', async () => {
    let resolve!: (p: string) => void;
    const onUploadImage = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const onSubmit = render({ onUploadImage });
    const shot = new File(['x'], 'image.png', { type: 'image/png' });
    const event = paste([shot]);
    expect(event.defaultPrevented).toBe(true);
    expect(onUploadImage).toHaveBeenCalledWith(shot);
    expect(container.querySelector('.argus-chat-attachment.is-uploading img')).not.toBeNull();
    const send = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    await act(async () => { resolve('/tmp/argus-chat-images/abc.png'); });
    expect(container.querySelector('.argus-chat-attachment.is-uploading')).toBeNull();
    act(() => send.click());
    expect(onSubmit).toHaveBeenCalledWith('/tmp/argus-chat-images/abc.png');
  });

  it('marks a failed upload and never sends it', async () => {
    const onUploadImage = vi.fn(() => Promise.reject(new Error('nope')));
    render({ onUploadImage });
    paste([new File(['x'], 'image.png', { type: 'image/png' })]);
    await act(async () => {});
    expect(container.querySelector('.argus-chat-attachment.is-failed')).not.toBeNull();
    expect((container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaves plain text pastes alone', () => {
    const onUploadImage = vi.fn();
    render({ onUploadImage });
    const event = paste([]);
    expect(event.defaultPrevented).toBe(false);
    expect(onUploadImage).not.toHaveBeenCalled();
  });
});


describe('ChatComposer — slash autocomplete', () => {
  const box = () => container.querySelector('textarea')!;
  function type(value: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box(), value);
      box().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const key = (k: string) => act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
  const items = () => Array.from(container.querySelectorAll('[role="option"]')).map((o) => o.querySelector('.argus-chat-slash-name')?.textContent);

  function renderWith(commands = [{ name: 'pr-review', description: 'Review a PR' }]) {
    const onSubmit = vi.fn();
    act(() => root.render(<ChatComposer status="idle" onSubmit={onSubmit} commands={commands} />));
    return onSubmit;
  }

  it('opens on a leading slash with built-ins and skills, filtered as you type', () => {
    renderWith();
    type('/');
    expect(items()).toContain('/model');
    expect(items()).toContain('/pr-review');
    type('/pr');
    expect(items()[0]).toBe('/pr-review');
    type('/pr-review 64');
    expect(items()).toEqual([]);
  });

  it('arrows move, Tab/Enter complete, Enter on a full command sends', () => {
    const onSubmit = renderWith();
    type('/res');
    expect(items()).toEqual(['/resume']);
    key('Enter');
    expect(box().value).toBe('/resume ');
    expect(onSubmit).not.toHaveBeenCalled();
    type('/co');
    key('ArrowDown');
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('/config');
    key('Tab');
    expect(box().value).toBe('/config ');
    type('/cost');
    key('Enter');
    expect(onSubmit).toHaveBeenCalledWith('/cost');
  });

  it('Enter sends a custom command typed in full even when a longer one is listed first', () => {
    const onSubmit = renderWith([{ name: 'deploy-staging', description: 'Staging' }, { name: 'deploy', description: 'Prod' }]);
    type('/deploy');
    key('Enter');
    expect(onSubmit).toHaveBeenCalledWith('/deploy');
  });

  it('stays closed while Claude waits at a menu', () => {
    act(() => root.render(<ChatComposer status="waiting" onSubmit={vi.fn()} />));
    type('/mo');
    expect(items()).toEqual([]);
  });

  it('Esc closes the list until the text changes; a click completes', () => {
    renderWith();
    type('/mo');
    key('Escape');
    expect(items()).toEqual([]);
    type('/mod');
    const opt = container.querySelector('[role="option"]')!;
    act(() => { opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
    expect(box().value).toBe('/model ');
  });
});
