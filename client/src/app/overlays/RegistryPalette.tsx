import type { ComponentProps } from 'react';
import type { CommandContext } from '../../commands/sources/index.js';
import { useCommandRegistry } from '../../commands/useCommandRegistry.js';
import { useSessionMenu, type SessionSurface } from '../ui/sessionMenuContext.js';
import { CommandPalette } from './CommandPalette.js';

type Props = Omit<ComponentProps<typeof CommandPalette>, 'commands'> & {
  ctx: Omit<CommandContext, 'menu' | 'beginRename'>;
  /** The surface showing the focused session's name (the rename editor's home). */
  renameSurface: SessionSurface;
};

/**
 * The ⌘K palette fed by the command registry. Rendered inside
 * SessionMenuProvider, which owns inline rename, and only while open, so the
 * registry is built only then.
 */
export function RegistryPalette({ ctx, renameSurface, ...palette }: Props) {
  const { beginRename, editIdentity } = useSessionMenu();
  const commands = useCommandRegistry({
    ...ctx,
    beginRename: (id) => beginRename(id, renameSurface),
    editIdentity: (session) => editIdentity(session),
  });
  return <CommandPalette {...palette} commands={commands} />;
}
