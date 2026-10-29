import { describe, it, expect, vi } from 'vitest';
import type { ElectronHelpBridge } from '../utils/platform.js';
import { runHelpAction } from './helpActions.js';

function bridge(over: Partial<ElectronHelpBridge> = {}): ElectronHelpBridge {
  return {
    appInfo: vi.fn(async () => null),
    copyDiagnostics: vi.fn(async () => ({ ok: true as const })),
    reportIssue: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

describe('runHelpAction', () => {
  it('confirms a copy', async () => {
    const toast = vi.fn();
    const b = bridge();
    await runHelpAction('copy-diagnostics', b, toast);
    expect(b.copyDiagnostics).toHaveBeenCalledOnce();
    expect(b.reportIssue).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Diagnostics copied to the clipboard', 'ok');
  });

  it('tells the user the diagnostics are on the clipboard when reporting', async () => {
    const toast = vi.fn();
    const b = bridge();
    await runHelpAction('report-issue', b, toast);
    expect(b.reportIssue).toHaveBeenCalledOnce();
    expect(toast.mock.calls[0][0]).toMatch(/clipboard/);
    expect(toast.mock.calls[0][1]).toBe('ok');
  });

  it('warns with the reason main gives', async () => {
    const toast = vi.fn();
    await runHelpAction('copy-diagnostics', bridge({ copyDiagnostics: async () => ({ ok: false, error: 'boom' }) }), toast);
    expect(toast).toHaveBeenCalledWith('Couldn’t copy the diagnostics: boom', 'warn');
  });

  it('warns when the IPC call rejects', async () => {
    const toast = vi.fn();
    await runHelpAction('report-issue', bridge({ reportIssue: async () => { throw new Error('gone'); } }), toast);
    expect(toast.mock.calls[0][1]).toBe('warn');
  });

  it('warns outside Electron', async () => {
    const toast = vi.fn();
    await runHelpAction('copy-diagnostics', undefined, toast);
    expect(toast.mock.calls[0][1]).toBe('warn');
  });
});
