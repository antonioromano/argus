/**
 * Beta F13 session-chain limits. Duplicated from @argus/shared (server code may
 * only `import type` from it — see CLAUDE.md); scripts/check-dep-sync.mjs keeps
 * the two copies equal.
 */
export const CHAIN_PROMPT_MAX = 4000;
export const CHAIN_MAX_FIRES_PER_HOUR = 10;
export const CHAIN_GLOBAL_MAX_FIRES_PER_HOUR = 30;
