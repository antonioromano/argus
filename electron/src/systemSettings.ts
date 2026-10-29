/**
 * macOS System Settings panes the renderer may ask main to open (plan 006; the
 * Help surfaces of plan 002 reuse it). The renderer sends a *pane key*, never a
 * URL: `openExternalAllowlisted` stays limited to http(s)/mailto, and the only
 * `x-apple.systempreferences:` URLs that can ever be opened are the constants
 * below. Pure, no electron import, so it is unit-testable.
 */
export const SYSTEM_SETTINGS_URLS = {
  // macOS 13+ (System Settings). The pre-13 `com.apple.preference.notifications`
  // id still resolves there too, but lands on the old pane name.
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
} as const;

export type SystemSettingsPane = keyof typeof SYSTEM_SETTINGS_URLS;

/** The fixed URL for a known pane, or null for anything else the renderer sends. */
export function systemSettingsUrl(pane: unknown): string | null {
  return typeof pane === 'string' && Object.hasOwn(SYSTEM_SETTINGS_URLS, pane)
    ? SYSTEM_SETTINGS_URLS[pane as SystemSettingsPane]
    : null;
}
