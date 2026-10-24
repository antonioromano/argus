import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { InspectorSide, PlanUsage, SessionUsage, TileRunningIndicator, UsageMeterPart, UsageMeterPartId, UsageWarnThresholds } from '@argus/shared';
import { Section, SettingRow, Segmented, Toggle } from '../../../../components/primitives/index.js';
import { QuickActionPreview } from '../../QuickActionSheet.js';
import { QuickActionPicker } from '../../../ui/QuickActionPicker.js';
import { UsageChip } from '../../../ui/UsageChip.js';
import { DEFAULT_TILE_QUICK_ACTION } from '../../../../constants/tileActions.js';
import { PART_LABELS, STEP, movePart, stepThreshold } from './usageMeterSettings.js';
import { usageMeterView, normalizeParts, DEFAULT_USAGE_PARTS, DEFAULT_WARN_CONTEXT, DEFAULT_WARN_PLAN } from '../../../../utils/usageFormat.js';
import type { PaneProps } from '../types.js';

const INSPECTOR_SIDE_OPTIONS: readonly { value: InspectorSide; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const INDICATOR_OPTIONS: readonly { value: TileRunningIndicator; label: string }[] = [
  { value: 'hairline', label: 'Hairline' },
  { value: 'off', label: 'Off' },
];

/**
 * The chip's parts as pills: drag to reorder, click to show or hide.
 * Alt+←/→ moves the focused pill for keyboard users.
 */
export function UsagePartPills({ parts, onChange }: { parts: UsageMeterPart[]; onChange: (next: UsageMeterPart[]) => void }) {
  // While dragging, the order is previewed locally and saved once on drop.
  const [draft, setDraft] = useState<UsageMeterPart[] | null>(null);
  const [dragId, setDragId] = useState<UsageMeterPartId | null>(null);
  const shown = draft ?? parts;

  const onDragOver = (e: DragEvent, overId: UsageMeterPartId) => {
    if (!dragId) return;
    e.preventDefault();
    const from = shown.findIndex((p) => p.id === dragId);
    const to = shown.findIndex((p) => p.id === overId);
    if (from !== to) setDraft(movePart(shown, from, to));
  };
  const finish = () => {
    if (draft && draft.some((p, i) => p.id !== parts[i]?.id)) onChange(draft);
    setDraft(null);
    setDragId(null);
  };
  const onKey = (e: KeyboardEvent, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    onChange(movePart(parts, index, index + (e.key === 'ArrowLeft' ? -1 : 1)));
  };

  return (
    <div className="argus-usage-pills" role="group" aria-label="Usage meter parts">
      {shown.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="argus-usage-pill"
          aria-pressed={p.on}
          data-part={p.id}
          data-dragging={dragId === p.id}
          draggable
          title={`${p.on ? 'Hide' : 'Show'} ${PART_LABELS[p.id]} · drag to reorder (Alt+←/→)`}
          onClick={() => onChange(parts.map((q) => (q.id === p.id ? { ...q, on: !q.on } : q)))}
          onKeyDown={(e) => onKey(e, i)}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', p.id);
            setDragId(p.id);
          }}
          onDragOver={(e) => onDragOver(e, p.id)}
          onDrop={(e) => { e.preventDefault(); finish(); }}
          onDragEnd={finish}
        >
          <span className="argus-usage-pill-name">{PART_LABELS[p.id]}</span>
          <span className="argus-usage-pill-grip" aria-hidden>⋮⋮</span>
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, value, onStep, min, max }: { label: string; value: number; onStep: (d: number) => void; min: number; max: number }) {
  return (
    <span className="argus-usage-stepper">
      {label}
      <span className="argus-usage-stepper-box">
        <button type="button" aria-label={`Lower ${label}`} disabled={value <= min} onClick={() => onStep(-STEP)}>−</button>
        <span aria-live="polite">{value}%</span>
        <button type="button" aria-label={`Raise ${label}`} disabled={value >= max} onClick={() => onStep(STEP)}>+</button>
      </span>
    </span>
  );
}

function ThresholdSteppers({ value, onChange, name }: { value: UsageWarnThresholds; onChange: (t: UsageWarnThresholds) => void; name: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--s-3)' }} role="group" aria-label={`${name} warning`}>
      <Stepper label="amber" value={value.amber} min={5} max={98} onStep={(d) => onChange(stepThreshold(value, 'amber', d))} />
      <Stepper label="red" value={value.red} min={6} max={99} onStep={(d) => onChange(stepThreshold(value, 'red', d))} />
    </span>
  );
}

type PreviewAgent = 'claude' | 'codex' | 'gemini';
const PREVIEW_AGENTS: readonly { value: PreviewAgent; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

/** Synthetic meter for the preview tile — never real data. */
function previewData(agent: PreviewAgent, ctxPct: number, planPct: number, now: number): { usage: SessionUsage; plan: PlanUsage } {
  const codex = agent === 'codex';
  const window = codex ? 258_400 : 200_000;
  const contextTokens = Math.round((window * ctxPct) / 100);
  return {
    usage: {
      inputTokens: 1_200_000,
      outputTokens: 310_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 18_400_000,
      totalTokens: 19_910_000,
      model: codex ? 'gpt-5.5' : 'claude-opus-5-5',
      contextTokens,
      contextWindow: window,
      contextPct: ctxPct,
      updatedAt: now,
    },
    plan: codex
      ? { observedAt: now, primary: { usedPct: planPct, windowMinutes: 43_200, resetsAt: now + 6 * 86_400_000 } }
      : {
          observedAt: now,
          primary: { usedPct: planPct, windowMinutes: 300, resetsAt: now + (2 * 60 + 19) * 60_000 },
          secondary: { usedPct: Math.round(planPct * 0.4), windowMinutes: 10_080, resetsAt: now + 4 * 86_400_000 },
        },
  };
}

export function ShellHeaderPane({ config, onSave }: PaneProps) {
  const action = config.tileQuickAction ?? DEFAULT_TILE_QUICK_ACTION;
  const indicator = config.tileRunningIndicator ?? 'hairline';
  const meterOn = config.showUsageMeter !== false;
  const parts = normalizeParts(config.usageMeterParts);
  const warnContext = config.usageWarnContext ?? DEFAULT_WARN_CONTEXT;
  const warnPlan = config.usageWarnPlan ?? DEFAULT_WARN_PLAN;

  // Preview-only state: which agent the tile pretends to be, and simulated values.
  const [previewAgent, setPreviewAgent] = useState<PreviewAgent>('claude');
  const [simCtx, setSimCtx] = useState(47);
  const [simPlan, setSimPlan] = useState(20);
  const [now] = useState(() => Date.now());
  const view = usageMeterView(config);
  const sample = useMemo(() => previewData(previewAgent, simCtx, simPlan, now), [previewAgent, simCtx, simPlan, now]);

  return (
    <>
      <Section title="Header content">
        <SettingRow
          label="Quick action"
          hint="One action pinned beside the window controls in every shell header. Everything else stays in the ⋯ menu."
        >
          <QuickActionPicker
            value={action}
            onChange={(tileQuickAction) => onSave({ tileQuickAction })}
            defaultAction={DEFAULT_TILE_QUICK_ACTION}
          />
        </SettingRow>
        <SettingRow
          label="Running indicator"
          hint="2px progress hairline under the header while an agent is working"
        >
          <Segmented
            label="Running indicator"
            value={indicator}
            options={INDICATOR_OPTIONS}
            onChange={(tileRunningIndicator) => { void onSave({ tileRunningIndicator }); }}
          />
        </SettingRow>
        <SettingRow
          label="Usage meter"
          hint="Context and plan usage on Claude and Codex shells. Gemini doesn’t report usage"
        >
          <Toggle checked={meterOn} onChange={(v) => onSave({ showUsageMeter: v })} />
        </SettingRow>
        <div className="argus-usage-nest" data-off={!meterOn} aria-disabled={!meterOn}>
          <SettingRow label="Show" hint="Drag to reorder · click to hide. Plan usage is per account, the same in every shell">
            <UsagePartPills parts={parts} onChange={(usageMeterParts) => onSave({ usageMeterParts })} />
          </SettingRow>
          <SettingRow label="Context warning" hint="Chip turns amber, then red, as a shell’s context fills">
            <ThresholdSteppers name="Context" value={warnContext} onChange={(usageWarnContext) => onSave({ usageWarnContext })} />
          </SettingRow>
          <SettingRow label="Plan usage warning" hint="Amber, then red, as you near your plan’s limit">
            <ThresholdSteppers name="Plan usage" value={warnPlan} onChange={(usageWarnPlan) => onSave({ usageWarnPlan })} />
          </SettingRow>
        </div>
        <SettingRow
          label="Pull request status"
          hint="PR number, state and CI checks for shells on a branch with a GitHub PR. Needs the gh CLI, logged in"
        >
          <Toggle checked={config.showPrStatus !== false} onChange={(v) => onSave({ showPrStatus: v })} />
        </SettingRow>
      </Section>

      <Section title="Session Inspector">
        <SettingRow
          label="Show inspector"
          hint="Hidden, the shell header shows usage, git and pull request as chips again. ⌘I toggles it"
        >
          <Toggle checked={config.inspectorVisible !== false} onChange={(v) => onSave({ inspectorVisible: v })} />
        </SettingRow>
        <SettingRow
          label="Position"
          hint="Usage, git and pull request of the open shell (or the selected tile). Left: in the sidebar, between Shells and System. Right: a column beside the shells. While the sidebar holding it is collapsed, the header shows them as chips"
        >
          <Segmented
            label="Inspector position"
            value={config.inspectorSide === 'right' ? 'right' : 'left'}
            options={INSPECTOR_SIDE_OPTIONS}
            onChange={(inspectorSide) => { void onSave({ inspectorSide }); }}
          />
        </SettingRow>
      </Section>

      {/* The preview sits in its own group below the controls: the quick action,
          the running indicator and the usage chip are the same header widget,
          so one preview covers all three, and it reads as a result rather than
          another setting. */}
      <Section title="Preview">
        <SettingRow hint="Minimize, expand and close are always shown. Hover the usage chip for its breakdown.">
          <div style={{ width: 380 }}>
            <QuickActionPreview
              action={action}
              runningIndicator={indicator}
              agent={previewAgent}
              name={{ claude: 'argus', codex: 'api-tests', gemini: 'docs' }[previewAgent]}
              chip={view && <UsageChip agentType={previewAgent} usage={sample.usage} plan={sample.plan} view={view} now={now} />}
            />
          </div>
        </SettingRow>
        <SettingRow label="Preview as">
          <Segmented label="Preview as" value={previewAgent} options={PREVIEW_AGENTS} onChange={setPreviewAgent} compact />
        </SettingRow>
        {previewAgent === 'gemini' ? (
          <SettingRow hint="Gemini doesn’t report context or plan usage, so its shells show no usage chip.">
            <span data-testid="usage-preview-gemini-note" />
          </SettingRow>
        ) : (
          <SettingRow label="Simulate" hint="Preview only — try the warning colors">
            <span style={{ display: 'inline-flex', gap: 'var(--s-3)', alignItems: 'center', fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                Context
                <input type="range" min={1} max={100} value={simCtx} aria-label="Simulated context %" onChange={(e) => setSimCtx(Number(e.target.value))} />
                <span style={{ minWidth: 32, fontFamily: 'var(--font-mono)' }}>{simCtx}%</span>
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                Plan
                <input type="range" min={1} max={100} value={simPlan} aria-label="Simulated plan usage %" onChange={(e) => setSimPlan(Number(e.target.value))} />
                <span style={{ minWidth: 32, fontFamily: 'var(--font-mono)' }}>{simPlan}%</span>
              </label>
            </span>
          </SettingRow>
        )}
        <SettingRow trailing>
          <button
            onClick={() => onSave({
              tileQuickAction: DEFAULT_TILE_QUICK_ACTION,
              tileRunningIndicator: 'hairline',
              usageMeterParts: DEFAULT_USAGE_PARTS.map((p) => ({ ...p })),
              usageWarnContext: { ...DEFAULT_WARN_CONTEXT },
              usageWarnPlan: { ...DEFAULT_WARN_PLAN },
            })}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 'var(--t-micro)',
              color: 'var(--fg-3)',
              textDecoration: 'underline',
            }}
          >
            Reset shell header to defaults
          </button>
        </SettingRow>
      </Section>
    </>
  );
}
