/**
 * Server copy of shared's AUTO_APPROVAL_TOOLS. Server code may only `import type`
 * from @argus/shared (app.asar has no node_modules/@argus), so the value lives
 * here too; scripts/check-dep-sync.mjs (check 3) fails the build if they drift.
 */
export const AUTO_APPROVAL_TOOLS = {
  Bash: 'command',
  Read: 'file',
  Edit: 'file',
  MultiEdit: 'file',
  Write: 'file',
  NotebookEdit: 'file',
} as const;

/** Audit entries kept per session (in memory, newest last). */
export const AUTO_APPROVAL_AUDIT_MAX = 50;

/** Rules allowed per folder. */
export const AUTO_APPROVAL_RULES_MAX = 100;
