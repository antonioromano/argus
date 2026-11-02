import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { UsageOmit } from './UsageChip.js';
import { STATUS_LABELS } from '../../constants/status.js';
import { describePr } from '../../utils/prFormat.js';
import { describeShellGit } from '../../utils/shellGit.js';
import { describeUsage, planFor, type UsageMeterState, type UsageRow } from '../../utils/usageFormat.js';

/**
 * Header info shedding (Mosaic tile + Focus header). The actions group is
 * `flex: none` and never moves; everything else sits in one info region that
 * takes the leftover width (`flex: 1 1 0`, so its width never depends on its
 * own content) and drops pieces, lowest priority first, until it fits:
 *
 *   1 reset age (↻ 4d), tokens and model
 *   2 plan usage
 *   3 context usage (the usage chip is gone)
 *   4 pills: branch, Native, stale, chain, shell git, PR
 *   5 status label (the status dot stays)
 *
 * The name truncates first, down to NAME_MIN_PX; a name cut narrower than that
 * counts as overflow too. Past the last level it may go further: the actions win.
 *
 * Whatever is shed is listed in the name's tooltip instead.
 */
export const SHED = { reset: 1, plan: 2, ctx: 3, pills: 4, status: 5 } as const;
export const MAX_SHED = SHED.status;
export const NAME_MIN_PX = 80;

/** Usage-chip parts hidden at a shed level. */
export function usageOmit(level: number): UsageOmit[] {
  const omit: UsageOmit[] = [];
  if (level >= SHED.reset) omit.push('reset', 'tok', 'model');
  if (level >= SHED.plan) omit.push('plan');
  if (level >= SHED.ctx) omit.push('ctx');
  return omit;
}

/** The region spills over, or the name is cut narrower than NAME_MIN_PX. */
function overflows(region: HTMLElement, name: HTMLElement | null): boolean {
  if (region.scrollWidth > region.clientWidth + 1) return true;
  return !!name && name.scrollWidth > name.clientWidth + 1 && name.clientWidth < NAME_MIN_PX;
}

/**
 * Shed level for the info region at `ref` (`nameRef`: its truncating name).
 * Width growth (ResizeObserver) or a `contentKey` change starts over from 0;
 * after every render, while the region still overflows, the level steps up one. Both run before paint except the
 * observer's re-render, which at worst shows one frame with too much shed —
 * never one with an action clipped (the region clips, the actions don't).
 */
export function useHeaderShed(
  ref: RefObject<HTMLElement | null>,
  nameRef: RefObject<HTMLElement | null>,
  contentKey: string,
): number {
  const [level, setLevel] = useState(0);
  const [key, setKey] = useState(contentKey);
  if (key !== contentKey) {
    setKey(contentKey);
    setLevel(0);
  }
  const widthRef = useRef(0);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    widthRef.current = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === widthRef.current) return;
      const grew = w > widthRef.current;
      widthRef.current = w;
      if (grew) setLevel(0);
      setTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  // Re-check the fit only when something that can change it did: a step up,
  // new content, or a resize. Not on every render — that is a forced reflow
  // per tile on each session update.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || level >= MAX_SHED) return;
    if (overflows(el, nameRef.current)) setLevel(level + 1);
  }, [ref, nameRef, level, contentKey, tick]);

  return level;
}

/** A piece of sheddable header info, as a tooltip row, tagged with the level that hides it. */
export interface ShedRow extends UsageRow {
  level: number;
}

/**
 * Every piece of info a header can shed, as tooltip rows. Doubles as the
 * content key: when any of it changes, the fit starts over. Usage only lists
 * once the whole chip is gone — before that the chip's own tooltip has it.
 * `branch` / `gitAndPr`: whether the header shows those at all (Focus never
 * shows the branch; with the inspector open it shows neither git nor PR).
 */
export function shedInfo(
  session: SessionInfo,
  opts: { usageMeter?: UsageMeterState | null; chainCount?: number; branch?: boolean; gitAndPr?: boolean } = {},
): ShedRow[] {
  const { pills, status, ctx } = SHED;
  const rows: ShedRow[] = [{ level: status, label: 'Status', value: STATUS_LABELS[session.status] }];
  if (opts.branch !== false && session.worktreeBranch) rows.push({ level: pills, label: 'Branch', value: session.worktreeBranch });
  if (session.runMode === 'direct') rows.push({ level: pills, label: 'Terminal', value: 'Native — stops when Argus quits' });
  if (session.worktreeStaleDays !== undefined) rows.push({ level: pills, label: 'Stale', value: `No commit for ${session.worktreeStaleDays} days` });
  if (opts.chainCount) rows.push({ level: pills, label: 'Chains', value: String(opts.chainCount) });
  if (opts.gitAndPr !== false) {
    if (session.cwd && session.shellGit) rows.push({ level: pills, label: 'Git', value: describeShellGit(session.cwd, session.shellGit) });
    if (session.pr) rows.push({ level: pills, label: 'PR', value: describePr(session.pr) });
  }
  if (opts.usageMeter) {
    const plan = planFor(opts.usageMeter.plans, session.agentType);
    for (const r of describeUsage(session.usage, plan, opts.usageMeter, Date.now())) rows.push({ level: ctx, ...r });
  }
  return rows;
}

/** The rows `level` has hidden, for the name tooltip. */
export function shedRows(info: readonly ShedRow[], level: number): UsageRow[] {
  return info.filter((r) => r.level <= level);
}

/** Content key of a header's sheddable info (see shedInfo). */
export function shedKey(info: readonly ShedRow[]): string {
  return info.map((r) => `${r.label}=${r.value}`).join('|');
}
