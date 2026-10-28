import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PromptOption, PromptTab } from '@argus/shared';
import { ChatPromptCard } from './ChatPromptCard.js';

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
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function render(prompt: string | undefined, options: PromptOption[] | undefined, tabs?: PromptTab[]) {
  const onAnswer = vi.fn<(key: string, text?: string) => Promise<string | null>>(async () => null);
  const onShowTerminal = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    root.render(<ChatPromptCard prompt={prompt} options={options} tabs={tabs} onAnswer={onAnswer} onCancel={onCancel} onShowTerminal={onShowTerminal} />);
  });
  return { onAnswer, onShowTerminal, onCancel };
}

const buttons = () => Array.from(container.querySelectorAll('button'));
const button = (text: string) => buttons().find((b) => b.textContent?.includes(text))!;

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ChatPromptCard', () => {
  it('a permission prompt: one button per option, answered with its key', async () => {
    const { onAnswer } = render('Do you want to proceed?', [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }]);
    expect(container.textContent).toContain('Do you want to proceed?');
    expect(buttons().map((b) => b.textContent)).toEqual(['1Yes', '2No']);
    await act(async () => button('No').click());
    expect(onAnswer).toHaveBeenCalledWith('2', undefined);
  });

  it('a free-text option opens a field; Enter sends the key with the text', async () => {
    const { onAnswer } = render('Which color do you prefer?', [
      { key: '1', label: 'Red' },
      { key: '2', label: 'Type something.', freeText: true },
    ]);
    act(() => button('Type something.').click());
    expect(onAnswer).not.toHaveBeenCalled();
    const input = container.querySelector<HTMLInputElement>('[data-testid="chat-prompt-free"] input')!;
    expect(button('Send').disabled).toBe(true);
    type(input, '  purple ');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onAnswer).toHaveBeenCalledWith('2', 'purple');
  });

  it('Esc closes the free-text field without answering', () => {
    const { onAnswer } = render('Would you like to proceed?', [
      { key: '1', label: 'Yes' },
      { key: '2', label: 'Tell Claude what to change', freeText: true },
    ]);
    act(() => button('Tell Claude').click());
    const input = container.querySelector<HTMLInputElement>('[data-testid="chat-prompt-free"] input')!;
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    window.removeEventListener('keydown', outside);
    expect(container.querySelector('[data-testid="chat-prompt-free"]')).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled(); // the app's Escape (close overlay / leave focus) stays out of it
  });

  it('a multiSelect question: toggles show their state, Continue moves on, free text points to the terminal', async () => {
    const { onAnswer, onShowTerminal } = render('Which fruits do you like?', [
      { key: '1', label: 'Apple', checked: true },
      { key: '2', label: 'Pear', checked: false },
      { key: '3', label: 'Type something', checked: false, freeText: true },
      { key: '4', label: 'Chat about this' },
    ]);
    expect(buttons().map((b) => b.textContent)).toEqual([
      'Apple', 'Pear', 'Type something — in the terminal', '4Chat about this', 'Continue',
    ]);
    await act(async () => button('Pear').click());
    expect(onAnswer).toHaveBeenLastCalledWith('2', undefined);
    await act(async () => button('Continue').click());
    expect(onAnswer).toHaveBeenLastCalledWith('next', undefined);
    act(() => button('in the terminal').click());
    expect(onShowTerminal).toHaveBeenCalled();
  });

  it('several questions: tabs with their state, Previous / Next between them, the pick marked', async () => {
    const { onAnswer } = render('Which README header style?', [
      { key: '1', label: 'Minimal' },
      { key: '2', label: 'Badges', chosen: true },
    ], [{ label: 'Header style', answered: true }, { label: 'Font', answered: false }]);
    const tabs = container.querySelector('[data-testid="chat-prompt-tabs"]')!;
    expect(tabs.textContent).toContain('Header style');
    expect(tabs.querySelectorAll('[data-answered]')).toHaveLength(1);
    // The pick, not the first option, is the highlighted one.
    expect(button('Badges').style.fontWeight).toBe('600');
    expect(button('Minimal').style.fontWeight).toBe('500');
    await act(async () => button('Next').click());
    expect(onAnswer).toHaveBeenLastCalledWith('next', undefined);
    await act(async () => button('Previous').click());
    expect(onAnswer).toHaveBeenLastCalledWith('prev', undefined);
    await act(async () => button('Minimal').click());
    expect(onAnswer).toHaveBeenLastCalledWith('1', undefined);
  });

  it('a multiSelect question among several: Next replaces Continue', () => {
    render('Which fruits do you like?', [{ key: '1', label: 'Apple', checked: true }, { key: '2', label: 'Pear', checked: false }],
      [{ label: 'Fruits', answered: true }, { label: 'Size', answered: false }]);
    expect(buttons().some((b) => b.textContent === 'Continue')).toBe(false);
    expect(button('Next')).toBeTruthy();
  });

  it('no readable options: the question still shows, with the terminal fallback', () => {
    const { onShowTerminal, onCancel } = render('Select model', undefined);
    expect(container.textContent).toContain('Select model');
    act(() => button('Open terminal').click());
    act(() => button('Cancel').click());
    expect(onShowTerminal).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the answer error the server returns', async () => {
    const onAnswer = vi.fn(async () => 'The prompt changed — open the shell to answer');
    act(() => {
      root.render(<ChatPromptCard prompt="Proceed?" options={[{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }]} onAnswer={onAnswer} onCancel={() => {}} onShowTerminal={() => {}} />);
    });
    await act(async () => button('Yes').click());
    expect(container.textContent).toContain('The prompt changed');
  });
});
