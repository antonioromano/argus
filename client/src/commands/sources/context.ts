import type { AppConfig, KeepAwakeStatus, MenuCommandWire, NgrokTunnelStatus, SessionInfo } from '@argus/shared';
import type { SessionMenuActions } from '../../app/ui/sessionMenu.js';
import type { ThemeMode } from '../../context/theme-context.js';
import type { ShortcutActionId } from '../../keyboard/registry.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';
import type { RendererMenuId } from '../useMenuCommandHandlers.js';

/**
 * Everything the static command sources read: app state plus the actions they
 * run. ArgusApp builds one while the palette is open; tests build a stub.
 * Adding a source that needs a new action means adding a field here.
 */
export interface CommandContext {
  closePalette(): void;
  config: AppConfig | null;
  updateConfig(patch: Partial<AppConfig>): void;
  shortcuts: ResolvedShortcuts;
  /** Open Settings at a pane, optionally scrolled to one setting (catalog id). */
  openSettings(pane?: string, focusSetting?: string): void;
  toast(message: string, tone?: 'ok' | 'warn'): void;

  // sources/menu.ts
  /** The app menu as main describes it (empty outside Electron). */
  menu: readonly MenuCommandWire[];
  runMenuCommand(id: RendererMenuId): void;
  invokeMenu(id: string): void;
  hasPendingLaunch: boolean;
  waitingCount: number;
  isDark: boolean;

  // sources/shortcuts.ts
  inspectorShown: boolean;
  toggleInspector(): void;
  /** The handler a registered keyboard scope (the explorer) owns for `id`, if active. */
  scopedHandler(id: ShortcutActionId): (() => void) | null;

  // sources/view.ts
  inspectorSide: 'left' | 'right';
  switchInspectorSide(): void;
  openBroadcast(): void;
  templatesEnabled: boolean;

  // sources/settings.ts
  themeMode: ThemeMode;
  setThemeMode(mode: ThemeMode): void;

  // sources/live.ts
  groups: readonly { id: string; name: string }[];
  activeGroupId: string | null;
  setActiveGroup(id: string | null): void;
  keepAwake: KeepAwakeStatus | null;
  armKeepAwake(durationMs: number | null): void;
  disarmKeepAwake(): void;
  tunnelStatus: NgrokTunnelStatus | null;
  stopTunnel(): void;
  /** The newer version when one is available, else null. */
  updateVersion: string | null;
  openUpdate(): void;

  // sources/session.ts
  /** The focused session (focused tile, or the one open in focus view). */
  focusedSession: SessionInfo | null;
  /** The ⋯ menu's actions; the session source builds the same entries from them. */
  sessionMenuActions: Omit<SessionMenuActions, 'onRename'>;
  /** Flip the focused session's name into its inline editor. */
  beginRename(id: string): void;
  /** Open "Color & emoji…" for a session (supplied by the palette host). */
  editIdentity?(session: SessionInfo): void;
  resumable: readonly SessionInfo[];
  resume(session: SessionInfo): void;
}
