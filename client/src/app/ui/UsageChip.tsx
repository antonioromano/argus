import { useEffect, useState, type ReactNode } from 'react';
import type { PlanUsage, SessionUsage } from '@argus/shared';
import { Tooltip } from '../../components/primitives/index.js';
import {
  describeUsage,
  effectiveWindow,
  formatResetIn,
  formatTokens,
  meterAgent,
  shortModel,
  usageLevel,
  worstLevel,
  type UsageLevel,
  type UsageRow,
  type UsageMeterView,
} from '../../utils/usageFormat.js';

interface UsageChipProps {
  agentType: string;
  /** This shell's meter (context, tokens, model). */
  usage?: SessionUsage;
  /** The agent account's plan usage (shared by every shell of that agent). */
  plan?: PlanUsage;
  view: UsageMeterView;
  /** Fixed clock (tests, settings preview). Default: live, ticking every 30 s. */
  now?: number;
  /** Parts a narrow header has shed (see headerShed); the tooltip still lists them. */
  omit?: readonly UsageOmit[];
}

/** A chip part a narrow header can drop; `reset` is the ↻ age inside plan. */
export type UsageOmit = 'ctx' | 'plan' | 'reset' | 'tok' | 'model';

const TICK_MS = 30_000;

/** Label / value grid of a usage-style tooltip (the chip's breakdown, a shed header's info). */
export function UsageRows({ rows, testId }: { rows: readonly UsageRow[]; testId?: string }) {
  return (
    <span className="argus-usage-pop" data-testid={testId}>
      {rows.map((r, i) => (
        <span key={i} className="argus-usage-pop-row">
          <b>{r.label}</b>
          <span>{r.value}</span>
        </span>
      ))}
    </span>
  );
}

/** The plan window nearest its limit (the one the chip shows). */
function shownWindow(plan: PlanUsage | undefined, now: number) {
  const a = effectiveWindow(plan?.primary, now);
  const b = effectiveWindow(plan?.secondary, now);
  if (!a) return b;
  if (!b) return a;
  return b.usedPct > a.usedPct ? b : a;
}

/**
 * Usage meter on a shell header (Claude and Codex): the parts the user picked,
 * in their order — context (bar + %), plan usage with its reset, tokens,
 * model. The chip takes the worst warning state of context and plan usage.
 * Values change, the box only grows with its text: hover shows a tooltip and
 * never resizes anything.
 */
export function UsageChip({ agentType, usage, plan, view, now: fixedNow, omit }: UsageChipProps) {
  const agent = meterAgent(agentType);
  const planOn = view.parts.some((p) => p.id === 'plan' && p.on);
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const ticking = fixedNow === undefined && planOn && !!plan;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setLiveNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [ticking]);
  const now = fixedNow ?? liveNow;

  if (!agent) return null;

  const ctxPct = usage?.contextPct;
  const ctxLevel = usageLevel(ctxPct, view.warnContext);
  const win = shownWindow(plan, now);
  const planLevel = usageLevel(win?.usedPct, view.warnPlan);

  const pieces: { key: string; node: ReactNode; level?: UsageLevel }[] = [];
  // The chip's warning counts every part that is on, shed or not: a narrow
  // header may drop the plan figure, never the alarm on the border.
  const levels: UsageLevel[] = [];
  for (const part of view.parts) {
    if (!part.on) continue;
    if (part.id === 'ctx' && ctxPct !== undefined) levels.push(ctxLevel);
    if (part.id === 'plan' && win) levels.push(planLevel);
  }
  for (const part of view.parts) {
    if (!part.on || omit?.includes(part.id as UsageOmit)) continue;
    if (part.id === 'ctx' && usage) {
      if (ctxPct !== undefined) {
        pieces.push({
          key: 'ctx',
          level: ctxLevel,
          node: (
            <>
              ctx <span className="argus-usage-bar" aria-hidden><i style={{ width: `${Math.min(100, Math.max(0, ctxPct))}%` }} /></span>
              {Math.round(ctxPct)}%
            </>
          ),
        });
      } else if (usage.contextTokens !== undefined) {
        pieces.push({ key: 'ctx', node: <>ctx {formatTokens(usage.contextTokens)}</> });
      }
    } else if (part.id === 'plan' && win) {
      pieces.push({
        key: 'plan',
        level: planLevel,
        node: (
          <>
            plan {Math.round(win.usedPct)}%
            {!win.reset && win.resetsAt !== undefined && !omit?.includes('reset') && (
              <>
                <span className="argus-usage-sep">·</span>↻ {formatResetIn(win.resetsAt - now)}
              </>
            )}
          </>
        ),
      });
    } else if (part.id === 'tok' && usage) {
      pieces.push({ key: 'tok', node: <>{formatTokens(usage.totalTokens)} tok</> });
    } else if (part.id === 'model' && usage?.model) {
      pieces.push({ key: 'model', node: <>{shortModel(usage.model)}</> });
    }
  }
  if (pieces.length === 0) return null;

  const breakdown = <UsageRows rows={describeUsage(usage, plan, view, now)} />;

  return (
    <Tooltip content={breakdown} position="bottom">
      <span className="argus-usage" data-testid="usage-chip" data-level={worstLevel(...levels)} tabIndex={0}>
        {pieces.map((p, i) => (
          <span key={p.key} style={{ display: 'contents' }}>
            {i > 0 && <span className="argus-usage-sep">·</span>}
            <span className="argus-usage-part" data-part={p.key} data-level={p.level}>{p.node}</span>
          </span>
        ))}
      </span>
    </Tooltip>
  );
}
