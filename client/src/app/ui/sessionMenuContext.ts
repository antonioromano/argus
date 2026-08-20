import { createContext, useContext } from 'react';
import type { SessionInfo } from '@argus/shared';

/** The surfaces that can show a shell name. A rename belongs to exactly one of
 *  them: several are on screen at once (a mosaic tile and its sidebar row), and
 *  an editor per surface would autofocus over — and so blur-cancel — the first. */
export type SessionSurface = 'tile' | 'tree' | 'focus' | 'chip';

export interface SessionMenuApi {
  /** Right-click handler: opens the shell action menu at the pointer. */
  openMenu: (session: SessionInfo, e: React.MouseEvent, surface: SessionSurface) => void;
  /** Flip a session's name into edit mode on one surface (used by the tile's own ⋯ menu). */
  beginRename: (id: string, surface: SessionSurface) => void;
  /** True while this session's name is being edited on *this* surface. */
  isRenaming: (id: string, surface: SessionSurface) => boolean;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
}

/** Inert default so a surface rendered outside the provider (tests, the mobile
 *  tree) degrades to "no menu, no rename" instead of throwing. */
const noop: SessionMenuApi = {
  openMenu: () => {},
  beginRename: () => {},
  isRenaming: () => false,
  commitRename: () => {},
  cancelRename: () => {},
};

export const SessionMenuContext = createContext<SessionMenuApi>(noop);

/** Surfaces that show a shell name (tile header, focus header, sidebar row, chip)
 *  read the menu + rename state from here instead of taking a dozen action props. */
export function useSessionMenu(): SessionMenuApi {
  return useContext(SessionMenuContext);
}
