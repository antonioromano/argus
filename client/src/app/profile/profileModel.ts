/**
 * Profiles, as plain data: what a profile captures, how it becomes a config
 * patch, and when the first-run card shows. No React here; ArgusApp and the
 * profile UI call these.
 */
import { DEFAULT_CONFIG, PROFILE_CONFIG_KEYS, type AppConfig, type Profile, type ProfileSettings, type ProfilesState } from '@argus/shared';
import type { ThemeMode } from '../../context/theme-context.js';
import { isPaletteId, type PaletteId } from '../../tokens/palettes.js';

/** Everything a profile captures right now: its config keys plus the device theme. */
export function currentSettings(config: AppConfig, themeMode: ThemeMode, palette: PaletteId): ProfileSettings {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_CONFIG_KEYS) out[k] = config[k] ?? DEFAULT_CONFIG[k];
  return { ...(out as ProfileSettings), themeMode, colorTheme: palette };
}

/** The config half of a profile, ready for PUT /api/config. Missing keys are left alone. */
export function configPatch(settings: ProfileSettings): Partial<AppConfig> {
  const patch: Record<string, unknown> = {};
  for (const k of PROFILE_CONFIG_KEYS) if (settings[k] !== undefined) patch[k] = settings[k];
  return patch as Partial<AppConfig>;
}

/** The theme half of a profile; undefined fields mean "leave as is". */
export function themeOf(settings: ProfileSettings): { mode?: ThemeMode; palette?: PaletteId } {
  return {
    mode: settings.themeMode,
    palette: isPaletteId(settings.colorTheme) ? settings.colorTheme : undefined,
  };
}

export function sameSettings(a: ProfileSettings, b: ProfileSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  return true;
}

/** "Antonio Romano" → "AR"; "argus" → "AR"; "" → "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]];
  const second = words.length > 1 ? [...words[words.length - 1]][0] : first[1] ?? '';
  return (first[0] + second).toUpperCase();
}

export function avatarText(p: Pick<Profile, 'name' | 'avatar'>): string {
  return p.avatar || initials(p.name);
}

export function makeProfile(name: string, settings: ProfileSettings, now: number, id: string = crypto.randomUUID()): Profile {
  return { id, name: name.trim() || 'My profile', avatar: '', createdAt: now, settings };
}

export function activeProfile(state: ProfilesState | null): Profile | null {
  if (!state?.activeId) return null;
  return state.profiles.find((p) => p.id === state.activeId) ?? null;
}

/** A name not already taken: "Work", "Work 2", "Work 3"… */
export function uniqueName(base: string, taken: readonly string[]): string {
  const set = new Set(taken.map((t) => t.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!set.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Someone who used Argus before profiles existed: they already saw an intro or the quick-action prompt. */
export function isExistingUser(config: AppConfig): boolean {
  return !!config.introSeen || !!config.quickActionPromptedAt;
}

export type ProfileCard = 'welcome' | 'upgrade' | null;

/**
 * First launch with profiles (`pending`, no profile): classify the user once
 * and persist it, so closing the intro (which stamps introSeen) can never turn
 * a brand-new user into an "existing" one. Returns null when there is nothing
 * to classify.
 */
export function classifyFirstLaunch(state: ProfilesState | null, config: AppConfig | null): 'existing' | 'new' | null {
  if (!state || !config || state.prompt !== 'pending' || state.profiles.length > 0) return null;
  return isExistingUser(config) ? 'existing' : 'new';
}

/** The corner card to show, if any; never while the intro is up or due. */
export function profileCardToShow(state: ProfilesState | null, introPending: boolean): ProfileCard {
  if (!state || introPending) return null;
  if (state.prompt === 'upgrade') return 'upgrade';
  if (state.prompt === 'welcome' && state.profiles.length === 0) return 'welcome';
  return null;
}
