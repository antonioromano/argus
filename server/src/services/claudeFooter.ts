/**
 * Claude Code's permission mode, read from the footer line it paints under the
 * prompt (B1 Chat view), e.g. `⏵⏵ auto mode on (shift+tab to cycle)` or
 * `⏸ manual mode on`. Anchored on the footer glyphs so a transcript line that
 * merely mentions "plan mode on" never matches.
 */
const FOOTER_MODE = /^\s*(?:⏵⏵|⏸)\s+(auto mode|manual mode|accept edits|plan mode|bypass permissions) on\b/i;

const MODE_IDS: Record<string, string> = {
  'auto mode': 'auto',
  'manual mode': 'default',
  'accept edits': 'acceptEdits',
  'plan mode': 'plan',
  'bypass permissions': 'bypassPermissions',
};

/** Modes the Chat view can ask for (the transcript's `permissionMode` values). */
export const SETTABLE_PERMISSION_MODES: readonly string[] = Object.values(MODE_IDS);

/** Shift+Tab: Claude Code cycles its permission mode on it. */
export const CYCLE_MODE_KEY = '\x1b[Z';

/** The mode shown in the bottom rows of a Claude screen, or undefined when no footer is visible. */
export function permissionModeFromFooter(rows: readonly string[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = FOOTER_MODE.exec(rows[i]);
    if (m) return MODE_IDS[m[1].toLowerCase()];
  }
  return undefined;
}
