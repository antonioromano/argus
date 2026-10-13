import type { LucideIcon } from 'lucide-react';

/** An action the palette can run (Waiting inbox, Broadcast, Resume …). */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Right-aligned detail: a shortcut or the target session. */
  hint?: string;
  /** Extra words the filter matches. */
  keywords?: string;
  icon?: LucideIcon;
  run: () => void;
}

/** Commands shown with an empty query; typing searches all of them. */
const MAX_IDLE_COMMANDS = 6;

export function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands.slice(0, MAX_IDLE_COMMANDS);
  return commands.filter((c) => `${c.label} ${c.keywords ?? ''} ${c.hint ?? ''}`.toLowerCase().includes(q));
}
