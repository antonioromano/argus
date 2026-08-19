import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SessionRenameInput } from './SessionRenameInput.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<React.ComponentProps<typeof SessionRenameInput>> = {}) {
  const onCommit = props.onCommit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  act(() => {
    root.render(<SessionRenameInput initial={props.initial ?? 'argus'} onCommit={onCommit} onCancel={onCancel} />);
  });
  return { input: container.querySelector('input')!, onCommit, onCancel };
}

/** Set a controlled input's value the way a user would — React tracks the value
 *  through the prototype descriptor, so assigning `.value` directly is ignored. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
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

describe('SessionRenameInput', () => {
  it('starts from the current name', () => {
    expect(render({ initial: 'billing spike' }).input.value).toBe('billing spike');
  });

  it('Enter commits the edited value', () => {
    const { input, onCommit, onCancel } = render();
    type(input, 'renamed');
    press(input, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('renamed');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape cancels without committing', () => {
    const { input, onCommit, onCancel } = render();
    type(input, 'discarded');
    press(input, 'Escape');
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur cancels — clicking away never silently renames', () => {
    const { input, onCommit, onCancel } = render();
    type(input, 'half typed');
    // React maps onBlur onto the bubbling `focusout` event, not `blur`.
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps keystrokes out of the surrounding terminal', () => {
    // React's listener sits on the root container, so the probe has to be above
    // it — that is exactly where a stray keystroke would reach the terminal.
    const { input } = render();
    const seen: string[] = [];
    const probe = (e: Event) => seen.push((e as KeyboardEvent).key);
    document.addEventListener('keydown', probe);
    press(input, 'a');
    document.removeEventListener('keydown', probe);
    expect(seen).toEqual([]);
  });

  it('caps typed length at the server-side maximum', () => {
    expect(render().input.maxLength).toBe(60);
  });
});
