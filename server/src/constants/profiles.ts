/**
 * Profile limits and allowed setting keys. Duplicated from @argus/shared (server
 * code may only `import type` from it — see CLAUDE.md); scripts/check-dep-sync.mjs
 * keeps the two copies equal.
 */
export const PROFILE_NAME_MAX = 40;
export const PROFILE_AVATAR_MAX = 16;
export const PROFILE_MAX = 20;

export const PROFILE_CONFIG_KEYS = [
  'density',
  'codeFontSize',
  'uiFontSize',
  'mosaicOrientation',
  'mosaicWaitingStyle',
  'showStatusBar',
  'tileQuickAction',
  'tileRunningIndicator',
  'showUsageMeter',
  'showPrStatus',
  'defaultSessionView',
  'notifyOnWaiting',
  'notifyOnDone',
  'notifyOnPrChecks',
  'notificationSound',
  'showTips',
] as const;
