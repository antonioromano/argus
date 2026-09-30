import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { CreateSheet } from './CreateSheet.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../../services/api.js', () => ({
  api: {
    checkWorktree: vi.fn(async () => ({ isGitRepo: false })),
    listBranchesForRepo: vi.fn(async () => ({ branches: [], currentBranch: 'main' })),
    gitInit: vi.fn(async () => ({})),
    pickFolder: vi.fn(async () => null),
  },
}));

let container: HTMLDivElement;
let root: Root;

const noop = () => {};
const asyncNoop = async () => {};

async function renderCreate(overrides: Partial<Parameters<typeof CreateSheet>[0]> = {}) {
  await act(async () => {
    root.render(
      <CreateSheet
        config={{ ...DEFAULT_CONFIG }}
        initialFolderPath="/tmp/project"
        onClose={noop}
        onCreate={asyncNoop}
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
    .find((b) => b.textContent?.startsWith('Spawn shell'));
  if (!btn) throw new Error('Spawn shell button not rendered');
  return btn as HTMLButtonElement;
}

function terminalTab(label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('[role="radio"]'))
    .find((b) => b.textContent?.startsWith(label));
  if (!btn) throw new Error(`${label} terminal tab not rendered`);
  return btn as HTMLButtonElement;
}

async function submit() {
  await act(async () => {
    submitButton().click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CreateSheet terminal', () => {
  it('defaults to Native when config.defaultRunMode is direct, and submits direct + web', async () => {
    const onCreate = vi.fn(async () => {});
    await renderCreate({ config: { ...DEFAULT_CONFIG, defaultRunMode: 'direct' }, onCreate });

    expect(terminalTab('Native').getAttribute('aria-checked')).toBe('true');

    await submit();

    expect(onCreate).toHaveBeenCalledWith(
      '/tmp/project',
      undefined,
      'claude',
      [],
      undefined,
      undefined,
      'web',
      'direct',
    );
  });

  it('sends direct + web after the user picks the Native tab', async () => {
    const onCreate = vi.fn(async () => {});
    await renderCreate({ onCreate }); // config.defaultRunMode is 'persistent'

    await act(async () => {
      terminalTab('Native').click();
    });
    expect(terminalTab('Native').getAttribute('aria-checked')).toBe('true');

    await submit();

    expect(onCreate).toHaveBeenCalledWith(
      '/tmp/project',
      undefined,
      'claude',
      [],
      undefined,
      undefined,
      'web',
      'direct',
    );
  });

  it('sends persistent + native after the user picks the Advanced tab', async () => {
    const onCreate = vi.fn(async () => {});
    await renderCreate({ onCreate });

    await act(async () => {
      terminalTab('Advanced').click();
    });
    await submit();

    expect(onCreate).toHaveBeenCalledWith(
      '/tmp/project',
      undefined,
      'claude',
      [],
      undefined,
      undefined,
      'native',
      'persistent',
    );
  });
});
