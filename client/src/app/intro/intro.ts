import type { AppConfig } from '@argus/shared';

/**
 * The one-time intro shown after an update (What's new) or on a first launch
 * (Welcome). `config.introSeen` holds the id of the last intro the user
 * finished or skipped; bump CURRENT_INTRO_ID in a release that has something
 * new to show and every existing user sees it once. An id rather than the app
 * version, so a patch release doesn't re-show the same content.
 */
export const CURRENT_INTRO_ID = 'terminal-kinds';

export type IntroFlow = 'whatsNew' | 'welcome';

/**
 * Which intro to open on launch, if any. Held back until both the config and
 * the running version are known, so nothing is stamped on a half-loaded boot.
 *
 * A brand-new user is one who has never answered any one-time prompt: both
 * `introSeen` and the older `quickActionPromptedAt` are empty. Everyone who ran
 * a previous release has the latter stamped, so they get What's new instead.
 */
export function introToShow(
  config: Pick<AppConfig, 'introSeen' | 'quickActionPromptedAt'> | null | undefined,
  version: string | null | undefined,
): IntroFlow | null {
  if (!config || !version) return null;
  if (config.introSeen === CURRENT_INTRO_ID) return null;
  if (!config.introSeen && !config.quickActionPromptedAt) return 'welcome';
  return 'whatsNew';
}
