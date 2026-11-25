import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, Flag, Gauge, LayoutGrid, Palette, PanelTop, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react';
import { DEFAULT_CONFIG, type AppConfig, type Profile } from '@argus/shared';
import { Button, Icon, Section, Segmented, SettingRow, Sheet, TextInput, Toggle } from '../../components/primitives/index.js';
import { useTheme } from '../../context/theme-context.js';
import { ColorThemePicker } from '../overlays/settings/panes/ColorThemePicker.js';
import { QuickActionPreview } from '../overlays/QuickActionSheet.js';
import { QuickActionPicker } from '../ui/QuickActionPicker.js';
import { WaitingStylePreview } from '../ui/WaitingStylePreview.js';
import { UsageChip } from '../ui/UsageChip.js';
import { ThresholdSteppers, UsagePartPills } from '../overlays/settings/panes/ShellHeaderPane.js';
import { previewData } from '../overlays/settings/panes/usageMeterSettings.js';
import { DEFAULT_WARN_CONTEXT, DEFAULT_WARN_PLAN, normalizeParts, usageMeterView } from '../../utils/usageFormat.js';
import { DEFAULT_TILE_QUICK_ACTION, tileActionMeta } from '../../constants/tileActions.js';
import {
  CODE_FONT_PRESETS, DEFAULT_CODE_FONT_PX, DEFAULT_UI_FONT_PX, DENSITY_OPTIONS, INDICATOR_OPTIONS,
  LAYOUT_OPTIONS, THEME_OPTIONS, UI_FONT_PRESETS, VIEW_OPTIONS, WAITING_OPTIONS, fontPreset,
} from '../overlays/settings/options.js';
import { paletteModeName } from '../../tokens/palettes.js';
import { initials } from './profileModel.js';

export type ProfileSheetMode = 'setup' | 'edit';

interface ProfileSheetProps {
  /** setup: guided steps with Continue / Back / Skip. edit: the same steps as free tabs. */
  mode: ProfileSheetMode;
  /** The profile being set up or edited (always the active one). */
  profile: Profile;
  /** The first profile on an upgrade: the intro says nothing changed. */
  fromUpgrade?: boolean;
  config: AppConfig;
  /** Every choice applies live. */
  onConfig: (patch: Partial<AppConfig>) => void;
  onIdentity: (patch: { name?: string; avatar?: string }) => void;
  /** Setup: put everything back (and drop a profile created for this setup). */
  onCancel: () => void;
  /** Setup finished, or edit closed. */
  onDone: () => void;
  /** Edit only: present when another profile exists to fall back to. */
  onDelete?: () => void;
}

type StepId = 'you' | 'theme' | 'look' | 'header' | 'usage' | 'sessions' | 'notify' | 'done';
interface Step { id: StepId; label: string; icon: LucideIcon; purpose?: string }

const STEPS: Step[] = [
  { id: 'you', label: 'You', icon: UserRound },
  { id: 'theme', label: 'Theme', icon: Palette, purpose: 'Colors for the whole app, terminals and editor included.' },
  { id: 'look', label: 'Look', icon: SlidersHorizontal, purpose: 'How dense the interface is and how big text reads.' },
  { id: 'header', label: 'Session header', icon: PanelTop, purpose: 'What every session header shows.' },
  { id: 'usage', label: 'Usage meter', icon: Gauge, purpose: 'The usage chip in Claude and Codex headers: what it shows, and when it turns amber or red.' },
  { id: 'sessions', label: 'Sessions', icon: LayoutGrid, purpose: 'How sessions are laid out, opened, and how a waiting one stands out.' },
  { id: 'notify', label: 'Notifications', icon: Bell, purpose: 'When Argus should interrupt you, while it is in the background.' },
  { id: 'done', label: 'Done', icon: Flag },
];

const AVATARS = ['', '🦉', '🚀', '🌊', '🔥', '🌱', '⚡️'];

/**
 * The profile, as steps. First time (setup) it is a guided walk: every choice
 * applies live, Cancel puts everything back. Reopened from the avatar (edit) the
 * same steps are tabs and changes save as you go. Each step fits without
 * scrolling: one short purpose line and one card of choices. Settings keeps
 * every control and the full explanations; this edits the same values.
 */
export function ProfileSheet({ mode, profile, fromUpgrade, config, onConfig, onIdentity, onCancel, onDone, onDelete }: ProfileSheetProps) {
  const guided = mode === 'setup';
  const steps = guided ? STEPS : STEPS.filter((s) => s.id !== 'done');
  // The upgrade notice lands on You, where it says nothing changed.
  const [index, setIndex] = useState(guided || fromUpgrade ? 0 : 1);
  const [furthest, setFurthest] = useState(index);
  const step = steps[index];
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [index]);

  const go = (i: number) => { setIndex(i); setFurthest((f) => Math.max(f, i)); };
  const last = step.id === 'done';

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', width: '100%' }}>
      <span className="eyebrow" style={{ flex: 1, color: 'var(--fg-3)' }}>
        {guided
          ? last ? 'Change any of this from your avatar, any time' : 'Changes apply as you choose · Cancel puts everything back'
          : 'Changes save as you go'}
      </span>
      {!guided && onDelete && <Button variant="ghost" onClick={onDelete}>Delete profile</Button>}
      {guided && !last && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      {guided && index > 0 && !last && <Button variant="outline" onClick={() => go(index - 1)}>Back</Button>}
      {guided && index > 0 && !last && <Button variant="ghost" onClick={() => go(index + 1)}>Skip</Button>}
      <Button
        variant="primary"
        onClick={() => (!guided || last ? onDone() : go(index + 1))}
      >
        {!guided ? 'Done' : last ? 'Start using Argus' : index === steps.length - 2 ? 'Finish' : 'Continue'}
      </Button>
    </div>
  );

  return (
    <Sheet
      eyebrow={guided ? 'SET UP YOUR PROFILE' : 'YOUR PROFILE'}
      title={profile.name}
      width={920}
      onClose={guided ? onCancel : onDone}
      footer={footer}
    >
      <div className="argus-profile-body">
        <nav className="argus-profile-nav" aria-label="Profile steps">
          <div className="eyebrow">{guided ? `Step ${index + 1} of ${steps.length}` : 'Profile'}</div>
          {steps.map((s, i) => {
            const done = guided && i < furthest && i !== index && s.id !== 'done';
            return (
              <button
                key={s.id}
                type="button"
                className={`settings-nav-item${i === index ? ' is-active' : ''}`}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => go(i)}
              >
                {done
                  ? <span className="argus-profile-nav-done"><Icon icon={Check} size="md" /></span>
                  : <Icon icon={s.icon} size="md" style={{ flexShrink: 0 }} />}
                <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>{s.label}</span>
              </button>
            );
          })}
        </nav>
        <main ref={mainRef} className="argus-profile-main argus-scroll">
          <div>
            {step.purpose && (
              <>
                <h2 className="argus-profile-title">{step.label}</h2>
                <p className="argus-profile-purpose">{step.purpose}</p>
              </>
            )}
            <StepBody id={step.id} profile={profile} fromUpgrade={fromUpgrade} config={config} onConfig={onConfig} onIdentity={onIdentity} />
          </div>
        </main>
      </div>
    </Sheet>
  );
}

function StepBody({ id, profile, fromUpgrade, config, onConfig, onIdentity }: {
  id: StepId;
  profile: Profile;
  fromUpgrade?: boolean;
  config: AppConfig;
  onConfig: (patch: Partial<AppConfig>) => void;
  onIdentity: (patch: { name?: string; avatar?: string }) => void;
}) {
  const { mode, setMode, theme, palette, setPalette } = useTheme();
  const v = <K extends keyof AppConfig>(k: K): NonNullable<AppConfig[K]> => (config[k] ?? DEFAULT_CONFIG[k]) as NonNullable<AppConfig[K]>;

  switch (id) {
    case 'you':
      return <YouStep profile={profile} fromUpgrade={fromUpgrade} onIdentity={onIdentity} />;
    case 'theme':
      return (
        <>
          <Section bare title="Color theme" action={<Segmented label="Appearance" value={mode} options={THEME_OPTIONS} onChange={setMode} />}>
            <ColorThemePicker compact value={palette} theme={theme} onChange={setPalette} />
          </Section>
          <p className="argus-profile-note">
            Each theme has a dark and a light version; Appearance decides which one shows. Now: {paletteModeName(palette, theme)}.
          </p>
        </>
      );
    case 'look':
      return (
        <Card>
          <SettingRow label="Density" hint="Row height and toolbar size; text size does not change">
            <Segmented label="Density" value={v('density')} options={DENSITY_OPTIONS} onChange={(density) => onConfig({ density })} />
          </SettingRow>
          <SettingRow label="Code" hint="Terminals, file viewer and diffs">
            <Segmented label="Code font size" compact value={fontPreset(CODE_FONT_PRESETS, config.codeFontSize, DEFAULT_CODE_FONT_PX)} options={CODE_FONT_PRESETS} onChange={(px) => onConfig({ codeFontSize: Number(px) })} />
          </SettingRow>
          <SettingRow label="Interface" hint="Menus, lists and settings">
            <Segmented label="Interface font size" compact value={fontPreset(UI_FONT_PRESETS, config.uiFontSize, DEFAULT_UI_FONT_PX)} options={UI_FONT_PRESETS} onChange={(px) => onConfig({ uiFontSize: Number(px) })} />
          </SettingRow>
          <SettingRow label="Show status bar" hint="Connection, session counts and the clock along the bottom">
            <Toggle checked={v('showStatusBar')} onChange={(showStatusBar) => onConfig({ showStatusBar })} />
          </SettingRow>
        </Card>
      );
    case 'header':
      return (
        <Card>
          <SettingRow label="Live preview" hint="Updates as you choose">
            <div style={{ width: 380 }}>
              <QuickActionPreview action={v('tileQuickAction')} runningIndicator={v('tileRunningIndicator')} />
            </div>
          </SettingRow>
          <SettingRow label="Quick action" hint="One button pinned in every session header">
            <QuickActionPicker value={v('tileQuickAction')} defaultAction={DEFAULT_TILE_QUICK_ACTION} onChange={(tileQuickAction) => onConfig({ tileQuickAction })} />
          </SettingRow>
          <SettingRow label="Running indicator" hint="A hairline while an agent works">
            <Segmented label="Running indicator" value={v('tileRunningIndicator')} options={INDICATOR_OPTIONS} onChange={(tileRunningIndicator) => onConfig({ tileRunningIndicator })} />
          </SettingRow>
          <SettingRow label="Pull request status" hint="PR state and CI checks">
            <Toggle checked={v('showPrStatus')} onChange={(showPrStatus) => onConfig({ showPrStatus })} />
          </SettingRow>
        </Card>
      );
    case 'usage':
      return <UsageStep config={config} onConfig={onConfig} />;
    case 'sessions':
      return (
        <Card>
          <SettingRow label="Arrangement" hint="Mosaic sessions side by side or stacked">
            <Segmented label="Session layout" value={v('mosaicOrientation')} options={LAYOUT_OPTIONS} onChange={(mosaicOrientation) => onConfig({ mosaicOrientation })} />
          </SettingRow>
          <SettingRow label="Open sessions in" hint="Chat where the agent has one; otherwise the terminal">
            <Segmented label="Open sessions in" value={v('defaultSessionView')} options={VIEW_OPTIONS} onChange={(defaultSessionView) => onConfig({ defaultSessionView })} />
          </SettingRow>
          <SettingRow label="Waiting style" hint="How a session waiting for input stands out">
            <Segmented label="Waiting attention style" value={v('mosaicWaitingStyle')} options={WAITING_OPTIONS} onChange={(mosaicWaitingStyle) => onConfig({ mosaicWaitingStyle })} />
          </SettingRow>
          <SettingRow label="Preview" hint="A waiting session, animating">
            <WaitingStylePreview style={v('mosaicWaitingStyle')} />
          </SettingRow>
        </Card>
      );
    case 'notify':
      return (
        <Card>
          <SettingRow label="A session needs your input">
            <Toggle checked={v('notifyOnWaiting')} onChange={(notifyOnWaiting) => onConfig({ notifyOnWaiting })} />
          </SettingRow>
          <SettingRow label="A session finishes a run">
            <Toggle checked={v('notifyOnDone')} onChange={(notifyOnDone) => onConfig({ notifyOnDone })} />
          </SettingRow>
          <SettingRow label="A pull request's checks finish">
            <Toggle checked={v('notifyOnPrChecks')} onChange={(notifyOnPrChecks) => onConfig({ notifyOnPrChecks })} />
          </SettingRow>
          <SettingRow label="Play a sound">
            <Toggle checked={v('notificationSound')} onChange={(notificationSound) => onConfig({ notificationSound })} />
          </SettingRow>
          <SettingRow label="Show tips" hint="At most one an hour, the first time a feature helps">
            <Toggle checked={v('showTips')} onChange={(showTips) => onConfig({ showTips })} />
          </SettingRow>
        </Card>
      );
    case 'done':
      return (
        <>
          <h2 className="argus-profile-title">All set, {profile.name.split(/\s+/)[0]}</h2>
          <p className="argus-profile-purpose">Your profile is saved; other windows follow it. Add more profiles from your avatar.</p>
          <Card>
            <SettingRow label="Theme"><span className="argus-profile-summary">{paletteModeName(palette, theme)}</span></SettingRow>
            <SettingRow label="Quick action"><span className="argus-profile-summary">{tileActionMeta(v('tileQuickAction')).label}</span></SettingRow>
            <SettingRow label="Sessions open in"><span className="argus-profile-summary">{v('defaultSessionView') === 'chat' ? 'Chat' : 'Terminal'}</span></SettingRow>
          </Card>
        </>
      );
  }
}

/**
 * The usage meter, built with the same controls as Settings → Session header:
 * a live header with the chip (and sliders to try the warning colors), the
 * switch, the parts (click to hide, drag to reorder) and the two thresholds.
 */
function UsageStep({ config, onConfig }: { config: AppConfig; onConfig: (patch: Partial<AppConfig>) => void }) {
  const [ctx, setCtx] = useState(47);
  const [plan, setPlan] = useState(20);
  const [now] = useState(() => Date.now());
  const on = config.showUsageMeter !== false;
  const view = usageMeterView(config);
  const sample = previewData('claude', ctx, plan, now);
  const action = config.tileQuickAction ?? DEFAULT_TILE_QUICK_ACTION;
  return (
    <Card>
      <SettingRow label="Live preview" hint="Drag the sliders to try the warning colors">
        <div className="argus-profile-usage-preview">
          <QuickActionPreview
            action={action}
            runningIndicator={config.tileRunningIndicator ?? 'hairline'}
            chip={view && <UsageChip agentType="claude" usage={sample.usage} plan={sample.plan} view={view} now={now} />}
          />
          <div className="argus-profile-usage-sim">
            <label>Context <input type="range" min={1} max={100} value={ctx} aria-label="Simulated context %" onChange={(e) => setCtx(Number(e.target.value))} /> {ctx}%</label>
            <label>Plan <input type="range" min={1} max={100} value={plan} aria-label="Simulated plan usage %" onChange={(e) => setPlan(Number(e.target.value))} /> {plan}%</label>
          </div>
        </div>
      </SettingRow>
      <SettingRow label="Show usage meter" hint="Gemini doesn’t report usage">
        <Toggle checked={on} onChange={(showUsageMeter) => onConfig({ showUsageMeter })} />
      </SettingRow>
      <div className="argus-usage-nest" data-off={!on} aria-disabled={!on}>
        <SettingRow label="Show" hint="Click to hide · drag to reorder">
          <UsagePartPills parts={normalizeParts(config.usageMeterParts)} onChange={(usageMeterParts) => onConfig({ usageMeterParts })} />
        </SettingRow>
        <SettingRow label="Context warning" hint="As a session’s context fills">
          <ThresholdSteppers name="Context" value={config.usageWarnContext ?? DEFAULT_WARN_CONTEXT} onChange={(usageWarnContext) => onConfig({ usageWarnContext })} />
        </SettingRow>
        <SettingRow label="Plan warning" hint="As you near your plan’s limit">
          <ThresholdSteppers name="Plan usage" value={config.usageWarnPlan ?? DEFAULT_WARN_PLAN} onChange={(usageWarnPlan) => onConfig({ usageWarnPlan })} />
        </SettingRow>
      </div>
    </Card>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <Section>{children}</Section>;
}

function YouStep({ profile, fromUpgrade, onIdentity }: { profile: Profile; fromUpgrade?: boolean; onIdentity: (patch: { name?: string; avatar?: string }) => void }) {
  // Typing edits locally; the name is saved once typing pauses, not per key.
  const [name, setName] = useState(profile.name);
  useEffect(() => {
    if (name.trim() === profile.name || !name.trim()) return;
    const t = setTimeout(() => onIdentity({ name: name.trim() }), 400);
    return () => clearTimeout(t);
  }, [name, profile.name, onIdentity]);

  return (
    <>
      <h2 className="argus-profile-title">{fromUpgrade ? 'Your look & feel, in one place' : 'Make Argus yours'}</h2>
      <p className="argus-profile-purpose">
        {fromUpgrade
          ? 'We gathered your current look & feel here. Nothing changed: review it, or edit anything.'
          : 'A few choices about how Argus looks and behaves around you. About a minute, and every step can be skipped.'}
      </p>
      <Card>
        <SettingRow label="Name" hint="Shown on your avatar">
          <TextInput value={name} onChange={setName} placeholder="Your name" autoFocus />
        </SettingRow>
        <SettingRow label="Avatar" hint="Your initials, or an emoji">
          <div className="argus-profile-emojis" role="group" aria-label="Avatar">
            {AVATARS.map((a) => (
              <button
                key={a || 'initials'}
                type="button"
                className="argus-profile-emoji"
                data-initials={a ? undefined : ''}
                aria-pressed={profile.avatar === a}
                aria-label={a ? `Avatar ${a}` : 'Use initials'}
                onClick={() => onIdentity({ avatar: a })}
              >
                {a || initials(name || profile.name)}
              </button>
            ))}
          </div>
        </SettingRow>
      </Card>
    </>
  );
}
