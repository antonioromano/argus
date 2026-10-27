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

describe('ChatComposer — live Markdown (D2)', () => {
  const box = () => container.querySelector('textarea')!;
  function type(value: string, caret = value.length) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box(), value);
      box().setSelectionRange(caret, caret);
      box().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const key = (k: string, init: KeyboardEventInit = {}) =>
    act(() => { box().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); });
  const layerText = () =>
    Array.from(container.querySelectorAll('[data-testid="composer-highlight"] > .argus-cmp-line'))
      .map((l) => (l.textContent ?? '').replace(/\u200b/g, ''))
      .join('\n');

  it('Enter continues a list instead of sending, Enter on the empty item ends it', () => {
    const onSubmit = render();
    type('- one');
    key('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box().value).toBe('- one\n- ');
    expect(box().selectionStart).toBe(box().value.length);
    expect(container.querySelector('.argus-chat-hint')?.textContent).toContain('⌘Enter to send');
    key('Enter');
    expect(box().value).toBe('- one\n');
    key('Enter');
    expect(onSubmit).toHaveBeenCalledWith('- one');
  });

  it('numbered lists continue and renumber; Cmd+Enter sends from inside a list', () => {
    const onSubmit = render();
    type('1. a\n2. b', 4);
    key('Enter');
    expect(box().value).toBe('1. a\n2. \n3. b');
    key('Enter', { metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith('1. a\n2. \n3. b');
  });

  it('Tab nests a list item and Shift+Tab steps it out; Tab elsewhere is left to the browser', () => {
    render();
    type('- a\n- b');
    key('Tab');
    expect(box().value).toBe('- a\n  - b');
    key('Tab', { shiftKey: true });
    expect(box().value).toBe('- a\n- b');
    type('plain');
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { box().dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
  });

  it('Enter inside a code fence adds a line', () => {
    const onSubmit = render();
    type('```ts');
    key('Enter');
    expect(box().value).toBe('```ts\n');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('only drops trailing blank lines on send', () => {
    const onSubmit = render();
    type('ends with spaces  \n  \n');
    key('Enter', { metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith('ends with spaces  ');
  });

  it('applies a list edit through insertText on just the changed span (native undo)', () => {
    render();
    type('- one');
    const calls: unknown[][] = [];
    const real = document.execCommand;
    document.execCommand = ((cmd: string, _ui: boolean, value: string) => {
      calls.push([cmd, value, box().selectionStart, box().selectionEnd]);
      return false; // jsdom cannot insert: the fallback still applies the edit
    }) as typeof document.execCommand;
    try {
      key('Enter');
    } finally {
      document.execCommand = real;
    }
    expect(calls).toEqual([['insertText', '\n- ', 5, 5]]);
    expect(box().value).toBe('- one\n- ');
  });

  it('shows very long text plain instead of parsing it on every keystroke', () => {
    render();
    const big = '**b** '.repeat(4000);
    type(big);
    expect(container.querySelector('.is-bold')).toBeNull();
    expect(layerText()).toBe(big);
  });

  it('leaves Enter alone during IME composition', () => {
    const onSubmit = render();
    type('- è');
    key('Enter', { isComposing: true });
    expect(box().value).toBe('- è');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('draws a styled copy of exactly the typed text, and sends plain Markdown', () => {
    const onSubmit = render();
    const src = '**bold** _it_ `code`\n- item\n\n```js\nconst x = 1;\n```';
    type(src);
    expect(layerText()).toBe(src);
    expect(container.querySelector('.is-bold')?.textContent).toBe('bold');
    expect(container.querySelector('.is-italic')?.textContent).toBe('it');
    expect(container.querySelector('span.is-code')?.textContent).toBe('code');
    expect(container.querySelector('.is-bullet')?.textContent).toBe('-');
    expect(container.querySelector('.argus-cmp-line.is-code')?.textContent).toBe('const x = 1;');
    key('Enter', { metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith(src);
  });
});
