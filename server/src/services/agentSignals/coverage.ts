import type { AgentSignalState } from '@argus/shared';

/** All native states — full coverage (Claude, Gemini hooks). */
export const ALL_STATES: readonly AgentSignalState[] = ['running', 'waiting', 'idle'];

/**
 * Static baseline of which states each built-in agent's native channel reports
 * (verified 2026-07-22 — plan 2026-07-22-001, Q1–Q3):
 *  - claude: hooks → running / waiting / idle (full)
 *  - gemini: hooks → running / waiting / idle (full)
 *  - codex:  notify → idle only (agent-turn-complete); waiting/running stay heuristic
 *
 * The arbiter suppresses a heuristic transition only for states in this set, so
 * a Codex `{idle}` adapter never suppresses heuristic `waiting`/`running`.
 * Adapters may refine coverage per session at spawn (e.g. a Codex hooks probe
 * upgrading to full) by passing `coverage` on the signal — that overrides this.
 */
export const AGENT_SIGNAL_COVERAGE: Record<string, readonly AgentSignalState[]> = {
  claude: ['running', 'waiting', 'idle'],
  gemini: ['running', 'waiting', 'idle'],
  codex: ['idle'],
};

/** Baseline coverage for an agent id. Unknown/custom agents default to full —
 *  moot unless native signals actually arrive (no injection ⇒ none do). */
export function coverageFor(agentType: string): readonly AgentSignalState[] {
  return AGENT_SIGNAL_COVERAGE[agentType] ?? ALL_STATES;
}
