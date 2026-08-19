import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { SessionInfo } from '@argus/shared';
import { SESSION_NAME_MAX } from '@argus/shared';
import { ContextMenu } from '../../components/primitives/index.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';
import { buildSessionMenuItems, type SessionMenuActions } from './sessionMenu.js';
import { SessionMenuContext, type SessionMenuApi } from './sessionMenuContext.js';

/**
 * Owns the one shell action menu for the whole app and the id of the name being
 * renamed. A single ContextMenu instance lives here, so two surfaces can never
 * strand two open menus, and the action handlers stay where they already are
 * (ArgusApp) instead of being threaded down into the sidebar and chip strip.
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
  const [menuAt, setMenuAt] = useState<{ session: SessionInfo; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const openMenu = useCallback((session: SessionInfo, e: React.MouseEvent) => {
    // Suppress Electron's native context menu and the surface's own click
    // (copy-path / open-session) so a right-click only opens this menu.
    e.preventDefault();
    e.stopPropagation();
    setMenuAt({ session, x: e.clientX, y: e.clientY });
  }, []);

  const commitRename = useCallback((id: string, name: string) => {
    const trimmed = name.trim().slice(0, SESSION_NAME_MAX);
    setRenamingId(null);
    if (trimmed) onRename(id, trimmed);
  }, [onRename]);

  const api = useMemo<SessionMenuApi>(() => ({
    openMenu,
    beginRename: setRenamingId,
    isRenaming: (id) => renamingId === id,
    commitRename,
    cancelRename: () => setRenamingId(null),
  }), [openMenu, renamingId, commitRename]);

  const items = menuAt
    ? buildSessionMenuItems(menuAt.session, { ...actions, onRename: (s) => setRenamingId(s.id) }, shortcuts)
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
