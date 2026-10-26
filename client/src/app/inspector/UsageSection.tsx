import { useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PlanUsage, PlanWindow, SessionUsage } from '@argus/shared';
import { Icon } from '../../components/primitives/index.js';
import {
  effectiveWindow,
  formatResetPhrase,
  formatTokens,
  meterAgent,
  planFor,
  planWindowLabel,
  planWindowKey,
  usageLevel,
  windowName,
  type UsageLevel,
} from '../../utils/usageFormat.js';
import type { InspectorSectionProps } from './types.js';
import { InspectorEmpty, InspectorRow } from './InspectorRow.js';

const TICK_MS = 30_000;

/**
 * One limit: a head line ("Session limit · 43%" left, the reset or the token
 * count right, wrapping under the label when the panel is narrow) over a
 * full-width bar. The percentage sits next to its label, in the primary
 * colour, so the value never reads as a footnote.
 */
function Meter({ label, labelTitle, pct, level, aside, asideTitle }: {
  label: string;
  /** Hover text on the label, e.g. the window length. */
  labelTitle?: string;
  pct: number;
  level: UsageLevel;
  /** Secondary right-hand text: "Resets in 3 hr 13 min", "94k / 200k". */
  aside?: string;
  asideTitle?: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="argus-inspector-meter" data-level={level}>
      <div className="argus-inspector-meter-head">
        <span className="argus-inspector-meter-title">
          <span className="argus-inspector-meter-label" title={labelTitle}>{label}</span>
          <span className="argus-inspector-meter-sep" aria-hidden> · </span>
          <span className="argus-inspector-meter-pct">{Math.round(pct)}%</span>
        </span>
        {aside && <span className="argus-inspector-meter-aside" title={asideTitle}>{aside}</span>}
      </div>
      <div
        className="argus-inspector-meter-bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <i style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/** Now, re-read every TICK_MS while `active` so resets count down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** The plan windows still worth showing, past resets folded to 0%. */
function liveWindows(plan: PlanUsage | undefined, now: number): PlanWindow[] {
  return [plan?.primary, plan?.secondary]
    .map((w) => effectiveWindow(w, now))
    .filter((w): w is PlanWindow => !!w);
}

function windowTitle(w: PlanWindow): string | undefined {
  const name = windowName(w.windowMinutes);
  return name ? `${name[0].toUpperCase()}${name.slice(1)} window` : undefined;
}

interface Share {
  key: string;
  label: string;
  tokens: number;
}

/** Share of a total as "24.9%", "<0.1%" for a sliver, "—" for nothing. */
function sharePct(n: number, total: number): string {
  if (!total || !n) return '—';
  const p = (n / total) * 100;
  return p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`;
}

function ShareRows({ title, rows, total }: { title: string; rows: Share[]; total: number }) {
  return (
    <div className="argus-inspector-shares">
      <div className="argus-inspector-shares-title">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="argus-inspector-share" data-share={r.key}>
          <span className="argus-inspector-swatch" data-share={r.key} aria-hidden />
          <span className="argus-inspector-share-label">{r.label}</span>
          <span className="argus-inspector-share-num">{formatTokens(r.tokens)}</span>
          <span className="argus-inspector-share-pct">{sharePct(r.tokens, total)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Expandable breakdown under the meters: how the context window is split
 * (used / free) and where the session's tokens went. The transcript only
 * reports token totals, so this is as fine-grained as the data gets.
 */
function UsageDetails({ usage }: { usage: SessionUsage }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const ctxWindow = usage.contextWindow;
  const used = usage.contextTokens;
  return (
    <div className="argus-inspector-disclosure" data-open={open || undefined}>
      <button
        type="button"
        className="argus-inspector-disclosure-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={ChevronRight} size={11} strokeWidth={2} className="argus-inspector-disclosure-chevron" />
        <span>Details</span>
        <span className="argus-inspector-disclosure-meta">{formatTokens(usage.totalTokens)} tokens</span>
      </button>
      {open && (
        <div id={bodyId} className="argus-inspector-disclosure-body">
          {ctxWindow !== undefined && used !== undefined && (
            <ShareRows
              title="Context window"
              total={ctxWindow}
              rows={[
                { key: 'used', label: 'Used', tokens: used },
                { key: 'free', label: 'Free space', tokens: Math.max(0, ctxWindow - used) },
              ]}
            />
          )}
          <ShareRows
            title="Session tokens"
            total={usage.totalTokens}
            rows={[
              { key: 'input', label: 'Input', tokens: usage.inputTokens },
              { key: 'output', label: 'Output', tokens: usage.outputTokens },
              { key: 'cache-read', label: 'Cache read', tokens: usage.cacheReadTokens },
              { key: 'cache-write', label: 'Cache write', tokens: usage.cacheCreationTokens },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** Context window and plan limits, one meter each, with an expandable token breakdown. */
export function UsageBody({ session, ctx }: InspectorSectionProps) {
  const meter = ctx.usageMeter;
  const agent = meterAgent(session.agentType);
  const plan = meter && agent ? planFor(meter.plans, session.agentType) : undefined;
  // Keyed on whether there is a plan, not on its identity: every usage:plan
  // broadcast hands a new object, which would restart the tick each time.
  const now = useNow(!!plan);

  if (!agent) return <InspectorEmpty>This agent doesn’t report usage.</InspectorEmpty>;
  if (!meter) return <InspectorEmpty>The usage meter is off (Settings → Shell header).</InspectorEmpty>;

  const usage = session.usage;
  const windows = liveWindows(plan, now);
  if (!usage && windows.length === 0) return <InspectorEmpty>No usage reported yet.</InspectorEmpty>;

  return (
    <>
      {usage?.contextPct !== undefined ? (
        <Meter
          label="Context"
          pct={usage.contextPct}
          level={usageLevel(usage.contextPct, meter.warnContext)}
          aside={usage.contextTokens !== undefined && usage.contextWindow
            ? `${formatTokens(usage.contextTokens)} / ${formatTokens(usage.contextWindow)}`
            : undefined}
          asideTitle="Tokens in the context window / its size"
        />
      ) : usage?.contextTokens !== undefined && (
        <InspectorRow label="Context">{formatTokens(usage.contextTokens)} tokens</InspectorRow>
      )}
      {windows.map((w, i) => (
        <Meter
          key={i}
          label={planWindowLabel(w.windowMinutes)}
          labelTitle={windowTitle(w)}
          pct={w.usedPct}
          level={usageLevel(w.usedPct, meter.warnPlan)}
          aside={w.reset
            ? 'Just reset'
            : w.resetsAt !== undefined ? formatResetPhrase(w.resetsAt, now) : undefined}
          asideTitle={w.reset
            ? 'The window has reset — waiting for a fresh reading'
            : w.resetsAt !== undefined ? new Date(w.resetsAt).toLocaleString() : undefined}
        />
      ))}
      {usage && <UsageDetails usage={usage} />}
    </>
  );
}

/** Collapsed-header glance: the context percentage and the fullest plan window. */
export function UsageGlance({ session, ctx }: InspectorSectionProps) {
  const meter = ctx.usageMeter;
  const plan = meter && meterAgent(session.agentType) ? planFor(meter.plans, session.agentType) : undefined;
  const now = useNow(!!plan);
  if (!meter || !meterAgent(session.agentType)) return null;
  const pct = session.usage?.contextPct;
  const fullest = liveWindows(plan, now).reduce<PlanWindow | undefined>((a, w) => (!a || w.usedPct > a.usedPct ? w : a), undefined);
  if (pct === undefined && !fullest) return null;
  // Compact so it fits the collapsed header: "ctx 47% · 5h 96%", each key dim
  // and each value in its level colour. The narrowest panel drops "ctx".
  return (
    <>
      {pct !== undefined && (
        <span title="Context window">
          <span className="argus-inspector-glance-key" data-key="ctx">ctx </span>
          <span data-level={usageLevel(pct, meter.warnContext)}>{Math.round(pct)}%</span>
        </span>
      )}
      {pct !== undefined && fullest && <span aria-hidden>·</span>}
      {fullest && (
        <span title={planWindowLabel(fullest.windowMinutes)}>
          <span className="argus-inspector-glance-key">{planWindowKey(fullest.windowMinutes)} </span>
          <span data-level={usageLevel(fullest.usedPct, meter.warnPlan)}>{Math.round(fullest.usedPct)}%</span>
        </span>
      )}
    </>
  );
}
