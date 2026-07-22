import type { AgentSignalState } from '@argus/shared';

/** Inputs an adapter needs to build its per-session injection. */
export interface SignalInjectionContext {
  sessionId: string;
  /** Resolved absolute path to the bundled argus-signal script. */
  signalBinPath: string;
  /** Directory for generated per-session config files (e.g. ~/.argus/signals). */
  signalDir: string;
  /** The user's own spawn flags for this session (may contain conflicting flags). */
  userFlags: string[];
}

/** A file the adapter needs written before spawn (e.g. a hooks settings file). */
export interface InjectionFile {
  path: string;
  content: string;
}

/** What an adapter contributes to a spawn. */
export interface SignalInjection {
  /** The FINAL flag list to spawn with — the adapter has already merged/stripped
   *  any conflicting user flags (e.g. Claude --settings deep-merge). */
  flags: string[];
  /** Agent-specific env to inject (common ARGUS_SIGNAL_URL/TOKEN are added by
   *  SessionManager, not here). */
  env: Record<string, string>;
  /** Files to write before spawn. */
  files: InjectionFile[];
}

/**
 * Per-agent native-signal adapter. `coverage` is the set of states this
 * mechanism reports (drives the arbiter's suppression); `inject` produces the
 * spawn-time flags/env/files that wire the agent's native hooks to argus-signal.
 */
export interface AgentSignalAdapter {
  readonly coverage: readonly AgentSignalState[];
  inject(ctx: SignalInjectionContext): SignalInjection;
}
