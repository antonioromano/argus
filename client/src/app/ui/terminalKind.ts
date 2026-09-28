import type { RunMode, TerminalEngine } from '@argus/shared';

/**
 * The one "Terminal" choice the user makes for a session. It folds two stored
 * fields into three options:
 *
 *   universal → runMode 'persistent' + terminalEngine 'web'
 *   advanced  → runMode 'persistent' + terminalEngine 'native'
 *   native    → runMode 'direct'     + terminalEngine 'web'
 *
 * The stored values stay as they are (sessions.json and config.json carry
 * them), so this module is the only place the mapping lives. "Direct + native
 * view" is not offered; an old record with that pair still reads as Native,
 * because the run mode is what the user feels (it stops when Argus quits).
 *
 * Strings only — the control is TerminalChoice.tsx (react-refresh wants a
 * component module to export nothing else).
 */
export type TerminalKind = 'universal' | 'advanced' | 'native';

export const TERMINAL_KINDS: readonly TerminalKind[] = ['universal', 'advanced', 'native'];

export function kindOf(runMode: RunMode | undefined, engine: TerminalEngine | undefined): TerminalKind {
  if (runMode === 'direct') return 'native';
  return engine === 'native' ? 'advanced' : 'universal';
}

export function settingsFor(kind: TerminalKind): { runMode: RunMode; terminalEngine: TerminalEngine } {
  switch (kind) {
    case 'advanced': return { runMode: 'persistent', terminalEngine: 'native' };
    case 'native': return { runMode: 'direct', terminalEngine: 'web' };
    default: return { runMode: 'persistent', terminalEngine: 'web' };
  }
}

export const KIND_LABEL: Record<TerminalKind, string> = {
  universal: 'Universal',
  advanced: 'Advanced',
  native: 'Native',
};

/** Shown next to the label; only Advanced carries one. */
export const KIND_BADGE: Partial<Record<TerminalKind, string>> = { advanced: 'Beta' };

/** One line, always visible under the tabs. */
export const KIND_TAGLINE: Record<TerminalKind, string> = {
  universal: 'Runs in the background. Works everywhere.',
  advanced: 'Runs in the background. Native Mac view.',
  native: 'Plain terminal. Stops when Argus quits.',
};

export const KIND_BEST_FOR: Record<TerminalKind, string> = {
  universal: 'long-running tasks you check from anywhere',
  advanced: 'long-running tasks on this Mac',
  native: 'long conversations, heavy copy & paste',
};

/** A comparison cell: yes, no, or a word that is neither (e.g. "medium"). */
export type KindCell = true | false | string;

export const KIND_COMPARISON: readonly { label: string; cells: Record<TerminalKind, KindCell> }[] = [
  { label: 'Survives quit', cells: { universal: true, advanced: true, native: false } },
  { label: 'Phone & remote', cells: { universal: true, advanced: true, native: true } },
  { label: 'Conversation length', cells: { universal: 'medium', advanced: 'medium', native: 'long' } },
  { label: 'Reliable links & copy', cells: { universal: false, advanced: false, native: true } },
  { label: 'Native Mac view', cells: { universal: false, advanced: true, native: false } },
];

export const KIND_SHARED_NOTE = 'All three: live status & notifications. Fixed once the session is created.';
