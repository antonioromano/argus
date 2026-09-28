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

describe('CloneSheet run mode', () => {
  it('preselects Direct for a source session with runMode "direct" and submits it', async () => {
    const onClone = vi.fn(async () => {});
    await renderClone({ currentRunMode: 'direct', onClone });

    const directButton = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Direct'));
    expect(directButton?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      submitButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClone).toHaveBeenCalledWith(
      '/tmp/project',
      'claude',
      [],
      undefined,
      'web',
      'direct',
    );
  });
});
