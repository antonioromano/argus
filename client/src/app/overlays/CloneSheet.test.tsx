import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { CloneSheet } from './CloneSheet.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../../services/api.js', () => ({
  api: {
    checkWorktree: vi.fn(async () => ({ isGitRepo: false })),
    gitInit: vi.fn(async () => ({})),
  },
}));

let container: HTMLDivElement;
let root: Root;

const noop = () => {};
const asyncNoop = async () => {};

async function renderClone(overrides: Partial<Parameters<typeof CloneSheet>[0]> = {}) {
  await act(async () => {
    root.render(
      <CloneSheet
        config={{ ...DEFAULT_CONFIG }}
        folderPath="/tmp/project"
        currentAgentType="claude"
        currentTerminalEngine="web"
        onClose={noop}
        onClone={asyncNoop}
        onSaveFlag={asyncNoop}
        {...overrides}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
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
  vi.clearAllMocks();
});

function submitButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent?.startsWith('Clone shell'));
  if (!btn) throw new Error('Clone shell button not rendered');
  return btn as HTMLButtonElement;
}

describe('CloneSheet terminal', () => {
  it('preselects Native for a source session with runMode "direct" and submits it', async () => {
    const onClone = vi.fn(async () => {});
    await renderClone({ currentRunMode: 'direct', onClone });

    const nativeTab = Array.from(container.querySelectorAll('[role="radio"]'))
      .find((b) => b.textContent === 'Native');
    expect(nativeTab?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      submitButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClone).toHaveBeenCalledWith(
      '/tmp/project',
      undefined,
      'claude',
      [],
      undefined,
      'web',
      'direct',
    );
  });
});

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CloneSheet shell name', () => {
  function nameInput(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="e.g. refactor-event-bus"]');
    if (!input) throw new Error('Shell name input not rendered');
    return input;
  }

  it('submits the typed shell name, trimmed', async () => {
    const onClone = vi.fn(async () => {});
    await renderClone({ onClone });

    typeInto(nameInput(), '  review-pass  ');
    await act(async () => {
      submitButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClone).toHaveBeenCalledWith('/tmp/project', 'review-pass', 'claude', [], undefined, 'web', 'persistent');
  });

  it('leaves the name to the server when the field is blank', async () => {
    const onClone = vi.fn(async () => {});
    await renderClone({ onClone });

    await act(async () => {
      submitButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClone).toHaveBeenCalledWith('/tmp/project', undefined, 'claude', [], undefined, 'web', 'persistent');
  });
});
