import { Coffee, Download, Globe, Layers } from 'lucide-react';
import { KEEP_AWAKE_OPTIONS } from '../../app/ui/keepAwakeFormat.js';
import type { Command } from '../types.js';
import type { CommandContext } from './context.js';

/**
 * Commands over live app state: the group filter, the keep-awake window,
 * remote access and updates. Each is gated by the state its own control
 * shows, so the palette never offers what the toolbar would not.
 */
export function liveSource(ctx: CommandContext): Command[] {
  const groups: Command[] = ctx.groups.map((g) => ({
    id: `group:${g.id}`,
    title: `Show group: ${g.name}`,
    category: 'Sessions',
    keywords: 'group filter folder',
    icon: Layers,
    checked: ctx.activeGroupId === g.id,
    source: 'live',
    run: () => ctx.setActiveGroup(g.id),
  }));
  if (ctx.activeGroupId !== null) {
    groups.push({
      id: 'group:all',
      title: 'Show all sessions',
      category: 'Sessions',
      keywords: 'group filter clear unfilter',
      icon: Layers,
      source: 'live',
      run: () => ctx.setActiveGroup(null),
    });
  }

  const awake = ctx.keepAwake?.active === true;
  // The toolbar menu's own windows: the server accepts only those.
  const keepAwake: Command[] = KEEP_AWAKE_OPTIONS.map((o) => ({
    id: `keepawake:${o.durationMs ?? 'indefinite'}`,
    title: o.durationMs === null ? 'Keep Mac awake until turned off' : `Keep Mac awake for ${o.label}`,
    category: 'App',
    hint: o.hint,
    keywords: 'keep awake sleep caffeinate power',
    icon: Coffee,
    source: 'live',
    run: () => ctx.armKeepAwake(o.durationMs),
  }));
  keepAwake.push({
    id: 'keepawake:off',
    title: 'Stop keeping Mac awake',
    category: 'App',
    keywords: 'keep awake sleep caffeinate power off disarm',
    icon: Coffee,
    source: 'live',
    when: awake,
    run: ctx.disarmKeepAwake,
  });

  const tunnelUp = ctx.tunnelStatus === 'connected' || ctx.tunnelStatus === 'connecting';
  const remote: Command[] = [
    // Starting needs a password, which lives in the pane: open it.
    {
      id: 'remote:start',
      title: 'Start remote access…',
      category: 'Remote',
      keywords: 'ngrok tunnel phone mobile companion remote',
      icon: Globe,
      source: 'live',
      when: !tunnelUp,
      run: () => ctx.openSettings('remote'),
    },
    {
      id: 'remote:stop',
      title: 'Stop remote access',
      category: 'Remote',
      keywords: 'ngrok tunnel phone mobile companion remote',
      icon: Globe,
      source: 'live',
      when: tunnelUp,
      run: ctx.stopTunnel,
    },
  ];

  const update: Command[] = [{
    id: 'update:install',
    title: `Install update ${ctx.updateVersion ?? ''}`.trim(),
    category: 'App',
    keywords: 'update upgrade new version release',
    icon: Download,
    source: 'live',
    when: ctx.updateVersion !== null,
    run: ctx.openUpdate,
  }];

  return [...groups, ...keepAwake, ...remote, ...update];
}
