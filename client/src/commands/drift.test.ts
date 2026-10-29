/**
 * The palette's CI gate: every menu item, keyboard action, settings pane,
 * boolean setting and beta flag must reach a palette command, or carry a
 * stated reason not to. Each failure names the file to edit.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type SessionInfo } from '@argus/shared';
import { MENU_COMMANDS, RENDERER_COMMAND_IDS, describeMenuCommands } from '../../../electron/src/menuModel.js';
import { MENU_SHORTCUT_DEFAULTS, type MenuShortcutId } from '../../../electron/src/menuShortcuts.js';
import { SHORTCUTS, SHORTCUTS_BY_ID } from '../keyboard/registry.js';
import { formatCombo } from '../keyboard/combo.js';
import { PANES } from '../app/overlays/settings/registry.js';
import { SETTINGS } from '../app/overlays/settings/catalog.js';
import { BETA_FEATURES } from '../utils/betaFlags.js';
import { createDedupeGate, createMenuEchoGuard } from '../keyboard/scopes.js';
import { menuCommandHandlers, type MenuCommandDeps } from './useMenuCommandHandlers.js';
import { COMMAND_SOURCES } from './sources/index.js';
import { PALETTE_SHORTCUT_EXCLUDE } from './sources/shortcuts.js';
import { stubContext } from './sources/testContext.js';
import type { Command } from './types.js';

const focused = { id: 's1', name: 'api', folderPath: '/r/api', status: 'idle', createdAt: '', agentType: 'claude', flags: [] } as SessionInfo;
const noop = () => {};

// Every gate open: a menu, a focused session, an active explorer scope.
const ctx = stubContext({
  menu: describeMenuCommands(),
  focusedSession: focused,
  sessionMenuActions: { onOpen: noop, onKill: noop, onRestart: noop },
  scopedHandler: () => noop,
  hasPendingLaunch: true,
});

// Raw source output: `when: false` rows count, since a gate only hides a row
// that exists (Beta: Disable while the flag is off).
const all: Command[] = COMMAND_SOURCES.flatMap((src) => [...src(ctx)]);
const names = new Set(all.flatMap((c) => [c.id, ...(c.aliases ?? [])]));

describe('palette drift', () => {
  it('every app-menu item has a palette command or a paletteExclude reason', () => {
    for (const def of MENU_COMMANDS) {
      if (def.paletteExclude) continue;
      const id = def.shortcut ? `shortcut:${def.shortcut}` : def.id;
      expect(
        names.has(def.id) || names.has(id),
        `menu item \`${def.id}\` has no palette command — add it to client/src/commands/sources/menu.ts or set paletteExclude in electron/src/menuModel.ts`,
      ).toBe(true);
    }
  });

  it('every renderer-run menu item has a handler the palette can run', () => {
    const gate = createDedupeGate();
    const deps = new Proxy({ paletteGate: gate, themeGate: gate, scopedEcho: createMenuEchoGuard() }, {
      get: (t, k) => (k in t ? t[k as keyof typeof t] : noop),
    }) as unknown as MenuCommandDeps;
    const handlers = menuCommandHandlers(deps);
    for (const id of RENDERER_COMMAND_IDS) {
      expect(Object.hasOwn(handlers, id), `menu item \`${id}\` has no handler — add it to client/src/commands/useMenuCommandHandlers.ts`).toBe(true);
    }
  });

  it('every keyboard action has a palette command or an exclusion reason', () => {
    for (const s of SHORTCUTS) {
      const reason = PALETTE_SHORTCUT_EXCLUDE[s.id];
      expect(
        names.has(`shortcut:${s.id}`) || !!reason?.trim(),
        `shortcut \`${s.id}\` has no palette command — add it to client/src/commands/sources/shortcuts.ts or PALETTE_SHORTCUT_EXCLUDE with a reason`,
      ).toBe(true);
    }
  });

  it('menu shortcut defaults match the keyboard registry', () => {
    for (const [id, combo] of Object.entries(MENU_SHORTCUT_DEFAULTS) as [MenuShortcutId, string][]) {
      expect(SHORTCUTS_BY_ID[id]?.defaultCombo, `electron/src/menuShortcuts.ts \`${id}\` default drifted from client/src/keyboard/registry.ts`).toBe(combo);
    }
  });

  it('every settings pane has an Open command', () => {
    for (const p of PANES) {
      expect(names.has(`settings.pane:${p.id}`), `pane \`${p.id}\` has no palette command — see client/src/commands/sources/settings.ts`).toBe(true);
    }
  });

  it('every boolean setting can be reached: toggled, opened, or a beta command', () => {
    const booleans = (Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]).filter((k) => typeof DEFAULT_CONFIG[k] === 'boolean');
    for (const key of booleans) {
      const s = SETTINGS.find((d) => d.keys.includes(key));
      expect(s, `boolean setting \`${key}\` has no catalog entry — add one to client/src/app/overlays/settings/catalog.ts`).toBeDefined();
      if (s!.palette === 'none') continue;
      const reached = names.has(`settings.toggle:${s!.id}`) || names.has(`settings.open:${s!.id}`) || names.has(`beta:${key}:on`);
      expect(reached, `boolean setting \`${key}\` has no palette command — see client/src/commands/sources/settings.ts`).toBe(true);
    }
  });

  it('every beta feature can be enabled and disabled', () => {
    for (const f of BETA_FEATURES) {
      expect(names.has(`beta:${f.flag}:on`) && names.has(`beta:${f.flag}:off`), `beta \`${f.flag}\` — see client/src/commands/sources/beta.ts`).toBe(true);
    }
  });

  it('hygiene: unique ids, no duplicate title within a category, every shortcut formats', () => {
    const ids = all.map((c) => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i), 'duplicate command ids').toEqual([]);
    const seen = new Map<string, string>();
    for (const c of all) {
      if (c.when === false) continue;
      const k = `${c.category}\u0000${c.title}`;
      // Rows that collapse into one through an alias are one command.
      const twin = seen.get(k);
      if (twin && !(c.aliases ?? []).includes(twin)) {
        expect.fail(`"${c.title}" appears twice under ${c.category} (${twin}, ${c.id})`);
      }
      seen.set(k, c.id);
      if (c.shortcut) expect(formatCombo(c.shortcut), `${c.id} shortcut`).not.toBe('');
    }
  });
});
