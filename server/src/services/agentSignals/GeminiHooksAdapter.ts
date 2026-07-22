import path from 'path';
import type { AgentSignalState } from '@argus/shared';
import type { AgentSignalAdapter, SignalInjection, SignalInjectionContext } from './types.js';

/**
 * Gemini CLI adapter (0.46.0+). Gemini ships Claude-style hooks, so this mirrors
 * the Claude adapter's coverage but injects via a *system settings file* pointed
 * at by GEMINI_CLI_SYSTEM_SETTINGS_PATH (env) rather than a --settings flag —
 * which leaves the user's ~/.gemini/settings.json untouched and keeps the hooks
 * hidden from Gemini's hooks UI (system-source). Correlation is via the
 * argus-signal --session argv (Gemini's own hook session_id differs from ours).
 *
 * Gemini's hook config is flatter than Claude's: settings.hooks.<Event> is a
 * direct array of command objects, plus a top-level hooksConfig.enabled.
 */
export class GeminiHooksAdapter implements AgentSignalAdapter {
  readonly coverage: readonly AgentSignalState[] = ['running', 'waiting', 'idle'];

  inject(ctx: SignalInjectionContext): SignalInjection {
    const base = `"${ctx.signalBinPath}" --session ${ctx.sessionId} --state`;
    const cmd = (rest: string) => ({ type: 'command' as const, command: `${base} ${rest}` });
    const content = {
      hooksConfig: { enabled: true },
      hooks: {
        BeforeAgent: [cmd('running')],
        BeforeTool: [cmd('running')],
        AfterAgent: [cmd('idle')],
        Notification: [cmd('waiting --prompt-from-stdin')],
      },
    };
    const settingsPath = path.join(ctx.signalDir, `gemini-${ctx.sessionId}.json`);
    return {
      flags: ctx.userFlags, // unchanged — injection is env-based, not a flag
      env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath },
      files: [{ path: settingsPath, content: JSON.stringify(content, null, 2) }],
    };
  }
}
