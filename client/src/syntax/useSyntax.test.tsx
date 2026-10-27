import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSynRanges, HIGHLIGHT_NAMES } from './useSyntax.js';
import type { SynToken } from './highlighter.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// jsdom has no CSS Custom Highlight API; a minimal stand-in records ranges.
class FakeHighlight extends Set<Range> {}
const registry = new Map<string, FakeHighlight>();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('Highlight', FakeHighlight);
  vi.stubGlobal('CSS', { highlights: registry });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Line({ text, tokens }: { text: string; tokens: SynToken[] | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useSynRanges(ref, tokens);
  return <span ref={ref}>{text}</span>;
}

const ranges = (name: string) => [...(registry.get(name) ?? [])].map((r) => r.toString());

describe('useSynRanges', () => {
  it('adds one range per slotted token over the single text node, and removes them on unmount', () => {
    const tokens: SynToken[] = [{ text: 'let', slot: 'kw' }, { text: ' x = ' }, { text: '"s"', slot: 'str' }];
    act(() => root.render(<Line text={'let x = "s"'} tokens={tokens} />));
    expect(ranges('argus-syn-kw')).toEqual(['let']);
    expect(ranges('argus-syn-str')).toEqual(['"s"']);
    // Still one text node: symbol nav and inline edit rely on it.
    expect(container.querySelector('span')!.childNodes).toHaveLength(1);
    act(() => root.render(<></>));
    expect(ranges('argus-syn-kw')).toEqual([]);
  });

  it('skips when the text no longer matches the tokens', () => {
    act(() => root.render(<Line text="edited" tokens={[{ text: 'let', slot: 'kw' }]} />));
    expect(ranges('argus-syn-kw')).toEqual([]);
  });

  it('names one highlight per slot', () => {
    expect(HIGHLIGHT_NAMES).toEqual(['argus-syn-kw', 'argus-syn-str', 'argus-syn-num', 'argus-syn-fn', 'argus-syn-cm', 'argus-syn-pn']);
  });
});
