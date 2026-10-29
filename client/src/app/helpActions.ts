import type { ElectronHelpBridge } from '../utils/platform.js';
import { pushToast, type ToastTone } from '../components/primitives/index.js';

/**
 * Help → Copy Diagnostics and Report an Issue, run the same way from the menu,
 * the palette and the About sheet (plan 002). Main writes the diagnostics to
 * the clipboard; a toast says it happened, because a clipboard write is
 * otherwise invisible.
 */
export type HelpActionKind = 'copy-diagnostics' | 'report-issue';

const DONE: Record<HelpActionKind, string> = {
  'copy-diagnostics': 'Diagnostics copied to the clipboard',
  'report-issue': 'Opening GitHub. Paste the diagnostics from your clipboard into the issue',
};

const FAILED: Record<HelpActionKind, string> = {
  'copy-diagnostics': 'Couldn’t copy the diagnostics',
  'report-issue': 'Couldn’t prepare the issue',
};

type Toast = (message: string, tone: ToastTone) => unknown;

export async function runHelpAction(
  kind: HelpActionKind,
  bridge: ElectronHelpBridge | undefined = window.electronHelp,
  toast: Toast = pushToast,
): Promise<void> {
  if (!bridge) {
    toast('Diagnostics are available in the Argus desktop app only', 'warn');
    return;
  }
  try {
    const res = kind === 'copy-diagnostics' ? await bridge.copyDiagnostics() : await bridge.reportIssue();
    if (res?.ok) toast(DONE[kind], 'ok');
    else toast(`${FAILED[kind]}: ${res?.error ?? 'no answer from Argus'}`, 'warn');
  } catch {
    toast(`${FAILED[kind]}. Try again from the Help menu`, 'warn');
  }
}
