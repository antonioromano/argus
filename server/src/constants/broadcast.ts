/**
 * Broadcast-input limits. Duplicated from @argus/shared (server code may only
 * `import type` from it — see CLAUDE.md); scripts/check-dep-sync.mjs keeps the
 * two copies equal.
 */
export const BROADCAST_MAX_TEXT = 4000;
export const BROADCAST_MAX_TARGETS = 50;
