import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { CreateSheet } from './CreateSheet.js';
import { onDiscovery, type DiscoveryEvent } from '../discovery/discoveryEvents.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const detectAgents = vi.fn();
vi.mock('../../services/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api.js')>()),
  api: {
    detectAgents: () => detectAgents(),
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

const claudeDef = { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true, installUrl: 'https://docs.anthropic.com/claude-code' };
const detection = (installed: boolean) => ({ agents: [{ agent: claudeDef, installed }] });

beforeEach(() => {
  detectAgents.mockResolvedValue(detection(true));
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

  it('reports the created session\'s resolved folder to discovery, not the typed one', async () => {
    const events: DiscoveryEvent[] = [];
    const off = onDiscovery((e) => events.push(e));
    const onCreate = vi.fn(async () => ({ folderPath: '/Users/me/project' }));
    await renderCreate({ onCreate });
    await submit();
    off();
    expect(events.find((e) => e.type === 'create')).toMatchObject({ folderPath: '/Users/me/project' });
  });
});

describe('CreateSheet agent preflight', () => {
  it('warns when the selected agent CLI is not on PATH, and still lets the session start', async () => {
    detectAgents.mockResolvedValue(detection(false));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    const onCreate = vi.fn(async () => {});
    await renderCreate({ onCreate });
    const notice = container.querySelector('[data-testid="agent-preflight"]')!;
    expect(notice.textContent).toContain('claude isn’t on your PATH');
    const labels = [...notice.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels[0]).toContain('curl -fsSL https://claude.ai/install.sh | bash');
    expect(labels).toContain('Open install page');
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('shows no notice when the agent is installed', async () => {
    await renderCreate();
    expect(detectAgents).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="agent-preflight"]')).toBeNull();
  });

  it('shows no notice when detection fails', async () => {
    detectAgents.mockRejectedValue(new Error('offline'));
    await renderCreate();
    expect(container.querySelector('[data-testid="agent-preflight"]')).toBeNull();
  });

  it('describes a spawn failure instead of printing its raw message', async () => {
    const { ApiError } = await import('../../services/api.js');
    const onCreate = vi.fn(async () => { throw new ApiError(400, 'Unknown agent type: nope', { code: 'AGENT_UNKNOWN', params: { agent: 'nope' } }); });
    await renderCreate({ onCreate });
    await submit();
    expect(container.textContent).toContain('Unknown agent');
    expect(container.textContent).toContain('isn’t set up in Argus');
  });
});
