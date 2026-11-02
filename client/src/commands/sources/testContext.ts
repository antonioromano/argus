import { DEFAULT_CONFIG } from '@argus/shared';
import { resolveShortcuts } from '../../keyboard/useShortcuts.js';
import type { CommandContext } from './context.js';

const noop = () => {};

/** Tests only: a full context where every action does nothing. Override what a test checks. */
export function stubContext(over: Partial<CommandContext> = {}): CommandContext {
  return {
    closePalette: noop,
    config: DEFAULT_CONFIG,
    updateConfig: noop,
    shortcuts: resolveShortcuts(),
    openSettings: noop,
    toast: noop,
    menu: [],
    runMenuCommand: noop,
    invokeMenu: noop,
    hasPendingLaunch: false,
    waitingCount: 0,
    isDark: true,
    inspectorShown: true,
    toggleInspector: noop,
    scopedHandler: () => null,
    inspectorSide: 'left',
    switchInspectorSide: noop,
    openBroadcast: noop,
    templatesEnabled: false,
    themeMode: 'system',
    setThemeMode: noop,
    groups: [],
    activeGroupId: null,
    setActiveGroup: noop,
    keepAwake: null,
    armKeepAwake: noop,
    disarmKeepAwake: noop,
    tunnelStatus: null,
    stopTunnel: noop,
    updateVersion: null,
    openUpdate: noop,
    focusedSession: null,
    sessionMenuActions: { onOpen: noop, onKill: noop, onRestart: noop },
    beginRename: noop,
    resumable: [],
    resume: noop,
    ...over,
  };
}
