import { useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PlanWindow, SessionUsage } from '@argus/shared';
import { Icon } from '../../components/primitives/index.js';
import {
  effectiveWindow,
  formatResetIn,
  formatTokens,
  friendlyModel,
  meterAgent,
  planFor,
  usageLevel,
  windowName,
  type UsageLevel,
} from '../../utils/usageFormat.js';
import type { InspectorSectionProps } from './types.js';
import { InspectorEmpty, InspectorRow } from './InspectorRow.js';

const TICK_MS = 30_000;

/** A labelled usage block: "47% used · 94k / 200k" over a bar, plus an optional note. */
function Meter({ label, pct, level, amount, note }: {
  label: string;
  pct: number;
  level: UsageLevel;
  /** Right-hand figure, e.g. "94k / 200k". */
  amount?: string;
  note?: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="argus-inspector-meter" data-level={level}>
      <div className="argus-inspector-label">{label}</div>
      <div className="argus-inspector-meter-head">
        <span className="argus-inspector-meter-pct">{Math.round(pct)}% used</span>
        {amount && <span className="argus-inspector-meter-amount">{amount}</span>}
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
      {note && <div className="argus-inspector-sub">{note}</div>}
    </div>
  );
}

function planLabel(w: PlanWindow): string {
  const name = windowName(w.windowMinutes);
  return name ? `Plan · ${name}` : 'Plan';
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
      <div className="argus-inspector-label">{title}</div>
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

/** Context window and plan usage together, with the model and an expandable token breakdown. */
export function UsageBody({ session, ctx }: InspectorSectionProps) {
  const meter = ctx.usageMeter;
  const agent = meterAgent(session.agentType);
  const plan = meter && agent ? planFor(meter.plans, session.agentType) : undefined;
  const [now, setNow] = useState(() => Date.now());
  // Keyed on whether there is a plan, not on its identity: every usage:plan
  // broadcast hands a new object, which would restart the tick each time.
  const hasPlan = !!plan;
  useEffect(() => {
    if (!hasPlan) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [hasPlan]);

  if (!agent) return <InspectorEmpty>This agent doesn’t report usage.</InspectorEmpty>;
  if (!meter) return <InspectorEmpty>The usage meter is off (Settings → Shell header).</InspectorEmpty>;

  const usage = session.usage;
  const windows = [plan?.primary, plan?.secondary]
    .map((w) => effectiveWindow(w, now))
    .filter((w): w is PlanWindow => !!w);
  if (!usage && windows.length === 0) return <InspectorEmpty>No usage reported yet.</InspectorEmpty>;

  return (
    <>
      {usage?.contextPct !== undefined ? (
        <Meter
          label="Context"
          pct={usage.contextPct}
          level={usageLevel(usage.contextPct, meter.warnContext)}
          amount={usage.contextTokens !== undefined && usage.contextWindow
            ? `${formatTokens(usage.contextTokens)} / ${formatTokens(usage.contextWindow)}`
            : undefined}
        />
      ) : usage?.contextTokens !== undefined && (
        <InspectorRow label="Context">{formatTokens(usage.contextTokens)} tokens</InspectorRow>
      )}
      {windows.map((w, i) => (
        <Meter
          key={i}
          label={planLabel(w)}
          pct={w.usedPct}
          level={usageLevel(w.usedPct, meter.warnPlan)}
          note={w.reset
            ? 'Reset — waiting for a fresh reading'
            : w.resetsAt !== undefined ? `Resets in ${formatResetIn(w.resetsAt - now)}` : undefined}
        />
      ))}
      {usage?.model && <InspectorRow label="Model" title={usage.model}>{friendlyModel(usage.model)}</InspectorRow>}
      {usage && <UsageDetails usage={usage} />}
    </>
  );
}

/** Collapsed-header glance: the context percentage. */
export function UsageGlance({ session, ctx }: InspectorSectionProps) {
  const pct = session.usage?.contextPct;
  if (!ctx.usageMeter || !meterAgent(session.agentType) || pct === undefined) return null;
  return <span data-level={usageLevel(pct, ctx.usageMeter.warnContext)}>{Math.round(pct)}% used</span>;
}
