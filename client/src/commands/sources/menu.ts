import type { MenuCommandWire } from '@argus/shared';
import type { Command, CommandCategory } from '../types.js';
import type { RendererMenuId } from '../useMenuCommandHandlers.js';
import type { CommandContext } from './context.js';

/** Menu items whose palette category is not their menu's. */
const CATEGORY_BY_ID: Readonly<Record<string, CommandCategory>> = {
  'menu:new-window': 'Window',
  'menu:new-session': 'Sessions',
  'menu:close-session': 'Focused session',
  'menu:review-launch': 'Sessions',
  'menu:waiting-inbox': 'Navigation',
  'menu:session-search': 'Navigation',
  'menu:open-diff': 'Focused session',
  'menu:open-files': 'Focused session',
  'menu:open-shell': 'Focused session',
  'menu:terminal-search': 'Focused session',
  'menu:clear-terminal': 'Focused session',
};

const CATEGORY_BY_SECTION: Readonly<Record<MenuCommandWire['section'], CommandCategory>> = {
  App: 'App',
  File: 'Sessions',
  View: 'View',
  Window: 'Window',
  Help: 'Help',
};

/** Items that end sessions. Their confirmations are the action's own. */
const DESTRUCTIVE = new Set(['menu:quit-stop-all', 'menu:close-session']);

/**
 * An Electron accelerator ('CmdOrCtrl+Shift+N') as a palette combo
 * ('mod+shift+n'). Plus becomes '=', the key it sits on.
 */
export function acceleratorToCombo(accel: string): string {
  const out: string[] = [];
  for (const raw of accel.split('+')) {
    const t = raw.toLowerCase();
    if (['cmdorctrl', 'commandorcontrol', 'cmd', 'command', 'ctrl', 'control', 'super', 'meta'].includes(t)) out.unshift('mod');
    else if (t === 'alt' || t === 'option') out.push('alt');
    else if (t === 'shift') out.push('shift');
    else if (t === 'plus') out.push('=');
    else out.push(t);
  }
  return out.join('+');
}

/**
 * One command per palette-visible app-menu item. Renderer items run through
 * the same handler map a menu click uses; main items go back over
 * `menu:invoke`. An item that mirrors a keyboard shortcut takes the
 * `shortcut:<id>` id (one action, one row, one frecency history) and keeps its
 * menu id as an alias.
 */
export function menuSource(ctx: CommandContext): Command[] {
  return ctx.menu.filter((m) => m.palette).map((m) => {
    const linked = m.shortcut;
    const combo = linked
      ? (ctx.shortcuts as Record<string, string>)[linked] ?? (m.accelerator ? acceleratorToCombo(m.accelerator) : undefined)
      : m.accelerator ? acceleratorToCombo(m.accelerator) : undefined;
    const cmd: Command = {
      id: linked ? `shortcut:${linked}` : m.id,
      aliases: linked ? [m.id] : undefined,
      title: m.label,
      category: CATEGORY_BY_ID[m.id] ?? CATEGORY_BY_SECTION[m.section],
      keywords: m.keywords,
      shortcut: combo,
      source: 'menu',
      destructive: DESTRUCTIVE.has(m.id) || undefined,
      run: m.runIn === 'main'
        ? () => ctx.invokeMenu(m.id)
        : () => ctx.runMenuCommand(m.id as RendererMenuId),
    };
    // Live state the cached menu description cannot carry.
    switch (m.id) {
      case 'menu:toggle-theme':
        cmd.title = ctx.isDark ? 'Use Light Appearance' : 'Use Dark Appearance';
        break;
      case 'menu:waiting-inbox':
        if (ctx.waitingCount > 0) cmd.hint = `${ctx.waitingCount} waiting`;
        cmd.keywords = 'waiting prompt approve answer pending needs input';
        break;
      case 'menu:session-search':
        cmd.keywords = 'find grep scrollback transcript history output everywhere';
        break;
      case 'menu:review-launch':
        cmd.when = ctx.hasPendingLaunch;
        break;
      case 'menu:open-diff':
      case 'menu:open-files':
      case 'menu:open-shell':
      case 'menu:terminal-search':
      case 'menu:clear-terminal':
      case 'menu:close-session':
        cmd.when = ctx.focusedSession !== null;
        if (ctx.focusedSession) cmd.hint = ctx.focusedSession.name;
        break;
    }
    return cmd;
  });
}
