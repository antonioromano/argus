import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FontSettingsProvider } from './FontSettingsContext.js';
import { useFontSettings } from './font-settings-context.js';

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

describe('FontSettingsProvider', () => {
  it('keeps the context value identity until a size actually changes', () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useFontSettings());
      return null;
    }
    const render = (code: number) => {
      act(() => {
        root.render(
          <FontSettingsProvider uiFontSize={14} codeFontSize={code}>
            <Probe />
          </FontSettingsProvider>,
        );
      });
    };
    render(13);
    render(13);
    expect(new Set(seen).size).toBe(1);

    render(15);
    expect(new Set(seen).size).toBe(2);
    expect(seen[seen.length - 1]).toEqual({ uiFontSize: 14, codeFontSize: 15 });
  });
});
