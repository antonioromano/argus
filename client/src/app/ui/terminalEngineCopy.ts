import type { TerminalEngine } from '@argus/shared';

/**
 * Every user-facing string about the terminal engine. One module so the
 * Create sheet, the Clone sheet, Settings, the update sheet and the quit
 * dialog cannot describe the same feature differently.
 *
 * Strings only — the control that presents the choice is EngineChoice.tsx.
 * Keeping them apart is what react-refresh requires: a module that exports a
 * component may export nothing else.
 *
 * The stored VALUES are still 'web' and 'native' — they are persisted in
 * config.json and on every session record, so renaming them would orphan
 * existing data. Only the labels changed.
 */

export const ENGINE_LABEL: Record<TerminalEngine, string> = {
  web: 'Universal',
  native: 'Advanced (macOS)',
};

/** Short form, for badges and inline references where the platform is implied. */
export const ENGINE_SHORT: Record<TerminalEngine, string> = {
  web: 'Universal',
  native: 'Advanced',
};

/**
 * What picking each one actually gets you. Deliberately about behaviour, not
 * implementation: "xterm.js" and "SwiftTerm" mean nothing to someone choosing.
 */
export const ENGINE_HINT: Record<TerminalEngine, string> = {
  web: 'Renders anywhere — this Mac, your phone, remote access. The safe default.',
  native:
    'A real macOS terminal view: smoother scrolling, sharper text, clean resizing. '
    + 'Only on this Mac — elsewhere the shell renders as Universal.',
};

/** Shown where the choice is being made for a NEW shell. */
export const ENGINE_NOTE_CREATE =
  'Advanced draws only on this Mac. Opened from your phone or over the network, the same shell '
  + 'renders as Universal — still fully usable, just without the native rendering. '
  + 'Fixed when the shell is created.';

/** Shown in Settings, where the choice is a default rather than a decision. */
export const ENGINE_NOTE_DEFAULT =
  'Applies to new shells only — existing ones keep the engine they were created with. '
  + 'Neither choice changes how long a shell runs: agents keep going when you quit Argus.';

/**
 * The one engine-specific risk in an update. The session and its scrollback are
 * untouched either way — the addon only decides how a tile is drawn, never how
 * the agent runs (terminalEngine never reaches the pty layer).
 */
export const ENGINE_NOTE_UPDATE =
  'These render as Universal if the new version’s native component fails to load. '
  + 'The shell and its history are unaffected — only how it is drawn.';
