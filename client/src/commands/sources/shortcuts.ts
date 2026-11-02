import { PanelLeft, PanelRight, Search } from 'lucide-react';
import type { ShortcutActionId } from '../../keyboard/registry.js';
import type { Command } from '../types.js';
import type { CommandContext } from './context.js';

/** Keyboard actions with no palette row, and why. The drift test reads this. */
export const PALETTE_SHORTCUT_EXCLUDE: Readonly<Partial<Record<ShortcutActionId, string>>> = {
  'terminal-newline': 'types into the terminal; not an action',
  'command-palette': 'is the palette',
};

/**
 * Keyboard actions the app menu does not carry (the menu source covers the
 * rest under the same `shortcut:<id>` ids, so it runs first and wins).
 */
export function shortcutsSource(ctx: CommandContext): Command[] {
  const combo = (id: ShortcutActionId) => ctx.shortcuts[id];
  const findInFiles = ctx.scopedHandler('find-in-files');
  return [
    {
      id: 'shortcut:toggle-inspector',
      // Same row as the catalog's "Show inspector" toggle; this one also
      // reveals a collapsed sidebar that holds it.
      aliases: ['settings.toggle:inspectorVisible'],
      title: ctx.inspectorShown ? 'Hide Session Inspector' : 'Show Session Inspector',
      category: 'View',
      keywords: 'inspector side panel show hide usage context git branch github pull request pr',
      shortcut: combo('toggle-inspector'),
      icon: ctx.inspectorSide === 'left' ? PanelLeft : PanelRight,
      checked: ctx.inspectorShown,
      source: 'shortcut',
      run: ctx.toggleInspector,
    },
    {
      id: 'shortcut:find-in-files',
      title: 'Find in files',
      category: 'Focused session',
      keywords: 'search grep explorer',
      shortcut: combo('find-in-files'),
      icon: Search,
      source: 'shortcut',
      // Live only while a file explorer has registered its scope.
      when: findInFiles !== null,
      run: () => findInFiles?.(),
    },
  ];
}
