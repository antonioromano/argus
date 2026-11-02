/**
 * The command registry: every row the ⌘K palette can run, from every source.
 *
 * API (stable; other plans register into it):
 *
 * - A **static source** is a pure `(ctx: CommandContext) => Command[]` in
 *   `sources/<name>.ts`, listed in `COMMAND_SOURCES` (sources/index.ts). Use
 *   one for anything the drift test must see (menu, shortcuts, settings, beta).
 *   It reads app state and actions only from `CommandContext`
 *   (sources/context.ts); add a field there for a new action.
 * - A **contribution** is for a feature that owns its own state and is not
 *   worth a `ctx` field (a help sheet, a tip, a checklist). Call
 *   `useRegisterCommands('help', commands)` from the component that owns the
 *   action, or `registerCommands(key, commands)` outside React; both replace
 *   the key's previous list and return/perform the unregister.
 * - `buildRegistry(sources, ctx, extra)` runs every source and appends the
 *   contributions, drops `when: false`, dedupes by id and alias (first wins),
 *   and wraps `run` to close the palette first unless the command `keepOpen`s.
 *
 * Ids are canonical and namespaced (see `Command` in types.ts); the palette's
 * frecency history is keyed by them.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Command, CommandSource } from './types.js';

export function buildRegistry<Ctx extends { closePalette(): void }>(
  sources: readonly CommandSource<Ctx>[],
  ctx: Ctx,
  extra: readonly Command[] = [],
): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  const add = (c: Command) => {
    if (c.when === false) return;
    const names = [c.id, ...(c.aliases ?? [])];
    if (names.some((n) => seen.has(n))) return;
    for (const n of names) seen.add(n);
    const run = c.run;
    out.push({
      ...c,
      run: c.keepOpen ? run : () => { ctx.closePalette(); run(); },
    });
  };
  for (const source of sources) for (const c of source(ctx)) add(c);
  for (const c of extra) add(c);
  return out;
}

// ── Contributions ─────────────────────────────────────────────────────────

const contributions = new Map<string, readonly Command[]>();
const listeners = new Set<() => void>();
let snapshot: readonly Command[] = [];

function publish(): void {
  snapshot = [...contributions.values()].flat();
  for (const l of listeners) l();
}

/** Set the commands contributed under `key` (replacing its last list). Returns the unregister. */
export function registerCommands(key: string, commands: readonly Command[]): () => void {
  contributions.set(key, commands);
  publish();
  return () => {
    if (contributions.get(key) !== commands) return;
    contributions.delete(key);
    publish();
  };
}

export function contributedCommands(): readonly Command[] {
  return snapshot;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Every contributed command; re-renders when a contribution changes. */
export function useContributedCommands(): readonly Command[] {
  return useSyncExternalStore(subscribe, contributedCommands);
}

/**
 * Contribute `commands` while the calling component is mounted. Pass a
 * memoized array: a new array identity re-registers.
 */
export function useRegisterCommands(key: string, commands: readonly Command[]): void {
  useEffect(() => registerCommands(key, commands), [key, commands]);
}

/** Tests only. */
export function resetContributionsForTests(): void {
  contributions.clear();
  publish();
}
