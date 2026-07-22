import type { AgentSignalState } from '@argus/shared';
import type { AgentSignalAdapter, SignalInjection, SignalInjectionContext } from './types.js';

/**
 * Codex adapter (0.142.0). Codex's only native channel is the `notify` config
 * program, which fires exactly one event — agent-turn-complete — so coverage is
 * `{idle}` and the arbiter leaves heuristic waiting/running untouched. We inject
 * `-c notify=[argus-signal, --session, <id>, --state, idle]`; Codex appends the
 * event JSON as a final argv the script ignores. Common ARGUS_SIGNAL_URL/TOKEN
 * env (added by SessionManager) reaches argus-signal via Codex's child env.
 *
 * Future: 0.142 ships experimental Claude-style hooks (permission_request =
 * exact waiting). When stable, probe at spawn and switch to the shared hook
 * shape with full coverage — the arbiter already keys off declared coverage.
 */
export class CodexNotifyAdapter implements AgentSignalAdapter {
  readonly coverage: readonly AgentSignalState[] = ['idle'];

  inject(ctx: SignalInjectionContext): SignalInjection {
    // If the user already configured notify, don't override it.
    if (ctx.userFlags.some((f) => f.startsWith('notify='))) {
      return { flags: ctx.userFlags, env: {}, files: [] };
    }
    const notifyProgram = [ctx.signalBinPath, '--session', ctx.sessionId, '--state', 'idle'];
    const notifyVal = `notify=${JSON.stringify(notifyProgram)}`;
    return {
      flags: [...ctx.userFlags, '-c', notifyVal],
      env: {},
      files: [],
    };
  }
}
