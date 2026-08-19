import { createContext, useContext } from 'react';
import type { SessionInfo } from '@argus/shared';

export interface SessionMenuApi {
  /** Right-click handler: opens the shell action menu at the pointer. */
  openMenu: (session: SessionInfo, e: React.MouseEvent) => void;
  /** Flip a session's name into edit mode (used by the tile's own ⋯ menu). */
  beginRename: (id: string) => void;
  /** True while this session's name is being edited on some surface. */
  isRenaming: (id: string) => boolean;
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
