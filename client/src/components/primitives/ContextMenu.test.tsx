import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContextMenu } from './ContextMenu.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('ContextMenu item hint', () => {
  it('renders a muted second line only for items that have one', () => {
    act(() => root.render(
      <ContextMenu
        x={0} y={0} onClose={vi.fn()}
        items={[
          { id: 'a', label: 'Plain', onClick: vi.fn() },
          { id: 'b', label: 'Hand off to a new session', hint: 'Beta · no model call', onClick: vi.fn() },
        ]}
      />,
    ));
    const [plain, hinted] = [...container.querySelectorAll('[role="menuitem"]')];
    expect(plain.querySelector('.argus-ctx-hint')).toBeNull();
    expect(plain.textContent).toBe('Plain');
    expect(hinted.querySelector('.argus-ctx-hint')?.textContent).toBe('Beta · no model call');
    expect(hinted.textContent).toContain('Hand off to a new session');
  });
});
