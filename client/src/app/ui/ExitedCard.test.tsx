import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExitedCard } from './ExitedCard.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('ExitedCard', () => {
  it('offers only Restart when there is nothing to resume', () => {
    act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} />));
    expect(buttons()).toEqual(['Restart']);
  });

  it('offers Resume conversation next to Restart, and each does its own thing', () => {
    const onRestart = vi.fn();
    const onResume = vi.fn();
    act(() => root.render(<ExitedCard folderPath="/repo" onRestart={onRestart} onResume={onResume} />));
    expect(buttons()).toEqual(['Resume conversation', 'Restart']);
    const [resume, restart] = [...container.querySelectorAll('button')];
    act(() => resume!.click());
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    act(() => restart!.click());
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
