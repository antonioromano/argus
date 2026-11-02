/**
 * Control-level search over the catalog. The filter box used to find panes
 * only; it now also lists the matching controls under each pane, so "seconds"
 * points at the row instead of at a pane you then have to scan.
 */
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { SETTINGS, SETTINGS_BY_ID, isSettingVisible, settingHint, type SettingDescriptor } from './catalog.js';
import { PANES, paneMatches, type PaneDef } from './registry.js';

/** Lower ranks first: where in the descriptor the query matched. */
export const RANK = { labelPrefix: 0, label: 1, keyword: 2, hint: 3, section: 4 } as const;

export interface SettingHit {
  setting: SettingDescriptor;
  rank: number;
  /** The row is not rendered right now (`visibleWhen` false). */
  hidden: boolean;
  /** Where to go instead while hidden: the parent toggle that reveals it. */
  revealVia?: SettingDescriptor;
}

function rankOf(s: SettingDescriptor, q: string, config: AppConfig): number | null {
  const label = s.label.toLowerCase();
  if (label.startsWith(q)) return RANK.labelPrefix;
  if (label.includes(q)) return RANK.label;
  if (s.keywords?.some((k) => k.toLowerCase().includes(q))) return RANK.keyword;
  if (settingHint(s, config)?.toLowerCase().includes(q)) return RANK.hint;
  if (s.section.toLowerCase().includes(q)) return RANK.section;
  return null;
}

/**
 * Every setting matching `query`, best first. Ties keep catalog order, which is
 * the order the rows appear on screen. Matching on the pane's own label is left
 * to the pane row itself — listing every control of "Keyboard" as a hit would
 * bury the ones that actually say what was typed.
 */
export function searchSettings(query: string, config: AppConfig = DEFAULT_CONFIG): SettingHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SettingHit[] = [];
  for (const setting of SETTINGS) {
    const rank = rankOf(setting, q, config);
    if (rank === null) continue;
    const hidden = !isSettingVisible(setting, config);
    const reveal = hidden && setting.revealVia ? SETTINGS_BY_ID[setting.revealVia] : undefined;
    hits.push({ setting, rank, hidden, revealVia: reveal });
  }
  // Array.prototype.sort is stable, so equal ranks keep catalog order.
  return hits.sort((a, b) => a.rank - b.rank);
}

/** Panes to list for a query: those matching on their own terms (title, group,
 *  broad keywords like "tmux") plus those holding a matching control. */
export function visiblePanes(query: string, hits: SettingHit[] = searchSettings(query)): PaneDef[] {
  const withHits = new Set(hits.map((h) => h.setting.pane));
  return PANES.filter((p) => withHits.has(p.id) || paneMatches(p, query));
}

/** The setting a jump should land on: the target itself, or while it is hidden,
 *  the toggle that reveals it. Unknown ids resolve to nothing. */
export function jumpTarget(id: string, config: AppConfig): SettingDescriptor | undefined {
  const s = SETTINGS_BY_ID[id];
  if (!s) return undefined;
  if (!isSettingVisible(s, config) && s.revealVia) return SETTINGS_BY_ID[s.revealVia] ?? s;
  return s;
}
