import type { CommandSource } from '../types.js';
import { betaSource } from './beta.js';
import type { CommandContext } from './context.js';
import { liveSource } from './live.js';
import { menuSource } from './menu.js';
import { sessionSource } from './session.js';
import { settingsSource } from './settings.js';
import { shortcutsSource } from './shortcuts.js';
import { viewSource } from './view.js';

export type { CommandContext } from './context.js';

/**
 * The static sources, in dedupe priority: the first to claim an id or alias
 * wins (the menu's `shortcut:open-diff` over the ⋯ menu's Diff).
 */
export const COMMAND_SOURCES: readonly CommandSource<CommandContext>[] = [
  menuSource,
  shortcutsSource,
  sessionSource,
  viewSource,
  liveSource,
  settingsSource,
  betaSource,
];
