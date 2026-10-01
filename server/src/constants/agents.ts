/**
 * Agent id of the plain login shell — a session with no AI attached.
 *
 * Duplicated from `SHELL_AGENT_ID` in `shared/src/types.ts` instead of imported:
 * server code may only ever `import type` from `@argus/shared` (see
 * constants/session.ts). `check:deps` keeps the two copies equal.
 */
export const SHELL_AGENT_ID = 'shell';
