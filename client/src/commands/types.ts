import type { LucideIcon } from 'lucide-react';

/**
 * Display order of the palette's category groups. `Recent` and `Suggested`
 * are not here: they are views over these, drawn above them on an empty query.
 */
export const COMMAND_CATEGORIES = [
  'Focused session',
  'Sessions',
  'Navigation',
  'View',
  'Window',
  'Settings',
  'Beta',
  'Remote',
  'App',
  'Help',
] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/**
 * One row of the command palette. Ids are canonical and namespaced, and the
 * frecency store is keyed by them, so never reuse an id for another action:
 * `menu:*`, `shortcut:*`, `settings.pane:*`, `settings.toggle:*`,
 * `settings.open:*`, `settings.set:<key>=<value>`, `beta:<flag>:on|off`,
 * `theme:*`, `font:*`, `group:*`, `keepawake:*`, `remote:*`, `update:*`,
 * `window:*`, `session:<menu item id>` (runs against the focused session, so
 * its history survives across sessions), `resume:<sessionId>`.
 */
export interface Command {
  id: string;
  title: string;
  category: CommandCategory;
  /** Extra words the matcher searches (space separated). */
  keywords?: string;
  /** Right-aligned detail: the target session, the current value. */
  hint?: string;
  /** Normalized combo ('mod+shift+f'), formatted with formatCombo at render. */
  shortcut?: string;
  icon?: LucideIcon;
  /** The source that produced it ('menu', 'settings', …); shown in the preview. */
  source: string;
  /** Rendered with the danger token. Confirmation policy is the action's own. */
  destructive?: boolean;
  /** A toggle or an option: true shows ✓, false shows an empty slot. */
  checked?: boolean;
  /** Leave the palette open after running (font size steps, pressed repeatedly). */
  keepOpen?: boolean;
  /** Setting id (settings/catalog.ts) Settings scrolls to and flashes. */
  focusKey?: string;
  /** Other ids that name the same action (a menu item behind a `shortcut:*`). */
  aliases?: readonly string[];
  /** False drops the command; mirrors the gate the action's own UI applies. */
  when?: boolean;
  run: () => void;
}

/** A pure producer of commands. Each lives in sources/ with its own test. */
export type CommandSource<Ctx> = (ctx: Ctx) => readonly Command[];
