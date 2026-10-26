import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HighlightedCode } from './HighlightedCode.js';
import { loadLang } from './highlighter.js';

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

describe('HighlightedCode', () => {
  it('renders plain text first, then slot spans once the grammar loads', async () => {
    const code = 'fn main() {\n    let x = 5;\n}';
    act(() => root.render(<HighlightedCode code={code} language="rs" />));
    expect(container.textContent).toBe(code);
    await act(async () => {
      await loadLang('rust');
    });
    expect(container.querySelector('.argus-syn-kw')?.textContent).toBe('fn');
    expect(container.querySelector('.argus-syn-num')?.textContent).toBe('5');
    expect(container.textContent).toBe(code);
  });

  it('stays plain for an unknown language', () => {
    act(() => root.render(<HighlightedCode code="+++ hello" language="klingon" />));
    expect(container.innerHTML).toBe('+++ hello');
  });
});
