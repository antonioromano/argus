import { buildSessionMenuItems } from '../../app/ui/sessionMenu.js';
import type { ContextMenuItem } from '../../components/primitives/index.js';
import type { Command } from '../types.js';
import type { CommandContext } from './context.js';

/** ⋯ entries that are also menu commands; the menu row wins when it exists. */
const MENU_TWIN: Readonly<Record<string, string>> = {
  diff: 'shortcut:open-diff',
  files: 'shortcut:open-files',
  shell: 'shortcut:open-shell',
  close: 'shortcut:close-shell',
};

/**
 * The focused session's ⋯ menu, entry for entry, with the gates every other
 * surface applies (beta handlers, per-session predicates). Ids are templates
 * (`session:rename`), not per session, so frecency follows the action.
 */
export function sessionSource(ctx: CommandContext): Command[] {
  const s = ctx.focusedSession;
  if (!s) return [];
  const actions = {
    ...ctx.sessionMenuActions,
    onRename: () => ctx.beginRename(s.id),
    onEditIdentity: ctx.editIdentity,
  };
  return buildSessionMenuItems(s, actions, ctx.shortcuts)
    .filter((e): e is ContextMenuItem => 'id' in e && !e.disabled)
    .map((item) => ({
      id: `session:${item.id}`,
      aliases: MENU_TWIN[item.id] ? [MENU_TWIN[item.id]] : undefined,
      title: item.label,
      category: 'Focused session',
      hint: s.name,
      keywords: 'session focused current',
      icon: item.icon,
      destructive: item.danger || undefined,
      source: 'session',
      run: item.onClick,
    }));
}
