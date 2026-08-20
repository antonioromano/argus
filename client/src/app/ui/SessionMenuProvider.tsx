import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { SessionInfo } from '@argus/shared';
import { SESSION_NAME_MAX } from '@argus/shared';
import { ContextMenu } from '../../components/primitives/index.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';
import { buildSessionMenuItems, type SessionMenuActions } from './sessionMenu.js';
import { SessionMenuContext, type SessionMenuApi, type SessionSurface } from './sessionMenuContext.js';

/**
 * Owns the one shell action menu for the whole app and the name being renamed.
 * A single ContextMenu instance lives here, so two surfaces can never strand two
 * open menus, and the action handlers stay where they already are (ArgusApp)
 * instead of being threaded down into the sidebar and chip strip.
 *
 * The rename is pinned to the *surface* the menu was opened from, not just the
 * session id: a tile and its sidebar row are on screen at once, so an id-only
 * flag opened an editor on both, and the second one's autoFocus blurred the
 * first — whose onBlur cancels — killing the rename in the same frame.
 */
export function SessionMenuProvider({
  actions,
  shortcuts,
  onRename,
  children,
}: {
  /** Everything except rename — that is owned here so the menu can flip a surface into edit mode. */
  actions: Omit<SessionMenuActions, 'onRename'>;
  shortcuts?: ResolvedShortcuts;
  onRename: (id: string, name: string) => void;
  children: ReactNode;
}) {
  const [menuAt, setMenuAt] = useState<
    { session: SessionInfo; x: number; y: number; surface: SessionSurface } | null
  >(null);
  const [renaming, setRenaming] = useState<{ id: string; surface: SessionSurface } | null>(null);

  const openMenu = useCallback((session: SessionInfo, e: React.MouseEvent, surface: SessionSurface) => {
    // Suppress Electron's native context menu and the surface's own click
    // (copy-path / open-session) so a right-click only opens this menu.
    e.preventDefault();
    e.stopPropagation();
    setMenuAt({ session, x: e.clientX, y: e.clientY, surface });
  }, []);

  const beginRename = useCallback((id: string, surface: SessionSurface) => {
    setRenaming({ id, surface });
  }, []);

  const commitRename = useCallback((id: string, name: string) => {
    const trimmed = name.trim().slice(0, SESSION_NAME_MAX);
    setRenaming(null);
    if (trimmed) onRename(id, trimmed);
  }, [onRename]);

  const api = useMemo<SessionMenuApi>(() => ({
    openMenu,
    beginRename,
    isRenaming: (id, surface) => renaming?.id === id && renaming.surface === surface,
    commitRename,
    cancelRename: () => setRenaming(null),
  }), [openMenu, beginRename, renaming, commitRename]);

  const items = menuAt
    ? buildSessionMenuItems(
        menuAt.session,
        { ...actions, onRename: (s) => beginRename(s.id, menuAt.surface) },
        shortcuts,
      )
    : [];

  return (
    <SessionMenuContext.Provider value={api}>
      {children}
      {menuAt && (
        <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} />
      )}
    </SessionMenuContext.Provider>
  );
}
