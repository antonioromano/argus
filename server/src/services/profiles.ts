import type { Profile, ProfilePrompt, ProfileSettings, ProfilesState } from '@argus/shared';
import { PROFILE_AVATAR_MAX, PROFILE_CONFIG_KEYS, PROFILE_MAX, PROFILE_NAME_MAX } from '../constants/profiles.js';

const PROMPTS: readonly ProfilePrompt[] = ['pending', 'welcome', 'later', 'upgrade', 'done'];
const ID_RE = /^[\w-]{1,64}$/;
/** Every key a profile may carry: the AppConfig keys plus the two device-local theme keys. */
const SETTING_KEYS = new Set<string>([...PROFILE_CONFIG_KEYS, 'themeMode', 'colorTheme']);

const PART_IDS = new Set(['ctx', 'plan', 'tok', 'model']);

/** The usage meter's parts: each known part at most once, as { id, on }. */
function sanitizeParts(v: unknown): { id: string; on: boolean }[] | null {
  if (!Array.isArray(v) || v.length > PART_IDS.size) return null;
  const seen = new Set<string>();
  const out: { id: string; on: boolean }[] = [];
  for (const p of v) {
    if (!p || typeof p !== 'object') return null;
    const { id, on } = p as Record<string, unknown>;
    if (typeof id !== 'string' || !PART_IDS.has(id) || seen.has(id) || typeof on !== 'boolean') return null;
    seen.add(id);
    out.push({ id, on });
  }
  return out;
}

/** A warning threshold pair: two finite numbers. */
function sanitizeThresholds(v: unknown): { amber: number; red: number } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { amber, red } = v as Record<string, unknown>;
  return typeof amber === 'number' && Number.isFinite(amber) && typeof red === 'number' && Number.isFinite(red) ? { amber, red } : null;
}

/** The few profile keys whose value is structured rather than primitive. */
const STRUCTURED: Record<string, (v: unknown) => unknown> = {
  usageMeterParts: sanitizeParts,
  usageWarnContext: sanitizeThresholds,
  usageWarnPlan: sanitizeThresholds,
};

/**
 * Keep only allowlisted keys: primitives, plus the usage meter's parts and
 * thresholds in their exact shapes. The config route applies the full per-key
 * validation when a profile is switched to, so this only has to stop a profile
 * from smuggling other structure or unknown keys into storage.
 */
export function sanitizeSettings(raw: unknown): ProfileSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SETTING_KEYS.has(k)) continue;
    if (STRUCTURED[k]) {
      const clean = STRUCTURED[k](v);
      if (clean !== null) out[k] = clean;
      continue;
    }
    if (typeof v === 'string' ? v.length <= 64 : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out as ProfileSettings;
}

function sanitizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return null;
  if (typeof p.name !== 'string') return null;
  const name = p.name.trim().slice(0, PROFILE_NAME_MAX);
  if (!name) return null;
  const avatar = typeof p.avatar === 'string' ? [...p.avatar].slice(0, PROFILE_AVATAR_MAX).join('') : '';
  const createdAt = typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : 0;
  return { id: p.id, name, avatar, createdAt, settings: sanitizeSettings(p.settings) };
}

/**
 * A ProfilesState with every field checked, or null when `raw` is not one at
 * all. Bad profiles are dropped, duplicate ids keep the first, the list is
 * capped at PROFILE_MAX, and an activeId that names no profile becomes the
 * first profile's (or null).
 */
export function sanitizeProfilesState(raw: unknown): ProfilesState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const profiles = (Array.isArray(r.profiles) ? r.profiles : [])
    .map(sanitizeProfile)
    .filter((p): p is Profile => !!p && !seen.has(p.id) && !!seen.add(p.id))
    .slice(0, PROFILE_MAX);
  const wanted = typeof r.activeId === 'string' ? r.activeId : null;
  const activeId = profiles.some((p) => p.id === wanted) ? wanted : (profiles[0]?.id ?? null);
  const prompt = PROMPTS.includes(r.prompt as ProfilePrompt) ? (r.prompt as ProfilePrompt) : 'pending';
  return { activeId, profiles, prompt };
}
