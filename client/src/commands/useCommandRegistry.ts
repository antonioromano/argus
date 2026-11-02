import { useEffect, useState } from 'react';
import type { MenuCommandWire } from '@argus/shared';
import { describeMenu } from './menuBridge.js';
import { buildRegistry, useContributedCommands } from './registry.js';
import { COMMAND_SOURCES, type CommandContext } from './sources/index.js';
import type { Command } from './types.js';

/**
 * The palette's commands: every static source run against `ctx`, plus the
 * contributed ones. The app menu's description is fetched over IPC once per
 * window (menuBridge caches it); until it lands the menu rows are absent.
 */
export function useCommandRegistry(ctx: Omit<CommandContext, 'menu'>): Command[] {
  const extra = useContributedCommands();
  const [menu, setMenu] = useState<readonly MenuCommandWire[]>([]);
  useEffect(() => {
    let live = true;
    void describeMenu().then((m) => { if (live) setMenu(m); });
    return () => { live = false; };
  }, []);
  return buildRegistry(COMMAND_SOURCES, { ...ctx, menu }, extra);
}
