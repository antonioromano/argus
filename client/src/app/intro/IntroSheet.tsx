import { useState, type ReactNode } from 'react';
import type { AppConfig, BetaFlag, RunMode, TerminalEngine } from '@argus/shared';
import { Activity, Check, Forward, GitBranch, LayoutGrid, Link, type LucideIcon } from 'lucide-react';
import { Sheet, Button } from '../../components/primitives/index.js';
import { TerminalChoice } from '../ui/TerminalChoice.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { KIND_LABEL, kindOf, settingsFor, type TerminalKind } from '../ui/terminalKind.js';
import { BETA_FEATURES } from '../../utils/betaFlags.js';
import type { IntroFlow } from './intro.js';

/** Per-feature slide copy and picture for the What's new carousel, in BETA_FEATURES order. */
const BETA_SLIDES: Record<BetaFlag, { text: string; icon: LucideIcon; picture: () => ReactNode }> = {
  betaWorktreeLifecycle: {
    text: 'Right-click a worktree shell → Finish… commits, pushes and opens a PR from one sheet. Merged worktrees can be removed; stale ones get flagged.',
    icon: GitBranch,
    picture: () => <WorktreePicture />,
  },
  betaActivityTimeline: {
    text: 'Focus a Claude shell and click Activity: a live feed of prompts, tool calls (command or file path, never contents), subagents and compactions. Applies to new or restarted shells.',
    icon: Activity,
    picture: () => <ActivityPicture />,
  },
  betaSessionTemplates: {
    text: 'Save a set of shells — agent, folder, optional new worktree, first prompt — and start them together into a new group. Settings → Launchers, or ⌘K → Launch template.',
    icon: LayoutGrid,
    picture: () => <TemplatesPicture />,
  },
  betaHandoff: {
    text: 'Right-click a shell → Hand off… starts a new shell with a brief of the old one: its diff and last messages. Built locally — no model call, no extra cost.',
    icon: Forward,
    picture: () => <HandoffPicture />,
  },
  betaSessionChains: {
    text: 'Right-click a shell → Chain to…: when it goes idle, waiting or done, Argus types a prompt into another shell. Fires once by default, loop-guarded and rate-capped.',
    icon: Link,
    picture: () => <ChainsPicture />,
  },
};

export interface IntroResult {
  /** Present when the user kept "Use … for new shells" ticked on the terminal step. */
  defaults?: { runMode: RunMode; terminalEngine: TerminalEngine };
  /** Welcome's last button: open the New shell sheet after closing. */
  openCreate?: boolean;
  /** What's new: the beta features the user ticked "Turn on" for. Only ticked ones appear. */
  betaFlags?: Partial<Record<BetaFlag, true>>;
}

interface Step { title: string; text: string; body: ReactNode }

/**
 * Step-by-step intro: one idea per screen, dots, Back / Next. Skip and Esc
 * still count as seen (the caller stamps `introSeen` either way) so it never
 * comes back on its own; Help → What's New reopens it.
 */
export function IntroSheet({
  flow,
  version,
  config,
  onDone,
}: {
  flow: IntroFlow;
  version: string;
  config: Pick<AppConfig, 'defaultRunMode' | 'defaultTerminalEngine'> | null;
  onDone: (result: IntroResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<TerminalKind>(kindOf(config?.defaultRunMode, config?.defaultTerminalEngine));
  const [makeDefault, setMakeDefault] = useState(true);
  const [turnOn, setTurnOn] = useState<ReadonlySet<BetaFlag>>(new Set());
  const toggleTurnOn = (flag: BetaFlag, on: boolean) => setTurnOn((prev) => {
    const next = new Set(prev);
    if (on) next.add(flag); else next.delete(flag);
    return next;
  });

  const terminalStep: Step = {
    title: 'Pick your terminal',
    text: flow === 'welcome'
      ? 'Choose how new shells run. Universal is the safe default.'
      : 'Sessions now come in three kinds. Choose the default for new shells — you can still pick per shell.',
    body: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
        <TerminalChoice value={kind} onChange={setKind} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-sm)', color: 'var(--fg-1)', cursor: 'pointer' }}>
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          Use {KIND_LABEL[kind]} for new shells
        </label>
      </div>
    ),
  };

  const steps: Step[] = flow === 'welcome'
    ? [
        {
          title: 'Welcome to Argus',
          text: 'Each shell runs a coding agent — Claude, Gemini or Codex — in a folder. Argus tracks their status and tells you when one needs you.',
          body: <HelloPicture />,
        },
        terminalStep,
        {
          title: 'Start your first shell',
          text: 'Pick a folder and an agent, then Spawn. ⌘N opens it any time.',
          body: <FirstShellPicture />,
        },
      ]
    : [
        {
          title: 'Five beta features to try',
          text: 'Early features, all off by default. Next: what each one does and where to find it. Tick the ones you want.',
          body: <BetaListPicture />,
        },
        ...BETA_FEATURES.map((f): Step => ({
          title: f.label,
          text: BETA_SLIDES[f.flag].text,
          body: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
              {BETA_SLIDES[f.flag].picture()}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-sm)', color: 'var(--fg-1)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid={`intro-turn-on-${f.flag}`}
                  checked={turnOn.has(f.flag)}
                  onChange={(e) => toggleTurnOn(f.flag, e.target.checked)}
                />
                Turn on {f.label}
              </label>
            </div>
          ),
        })),
        {
          title: 'You’re set',
          text: 'Change any of these later in Settings → Beta features.',
          body: <SummaryPicture on={BETA_FEATURES.filter((f) => turnOn.has(f.flag)).map((f) => f.label)} />,
        },
      ];

  const last = step === steps.length - 1;
  const finish = () => {
    if (flow === 'welcome') {
      onDone({ defaults: makeDefault ? settingsFor(kind) : undefined, openCreate: true });
      return;
    }
    const betaFlags: Partial<Record<BetaFlag, true>> = {};
    for (const flag of turnOn) betaFlags[flag] = true;
    onDone({ betaFlags });
  };
  const skip = () => onDone({});
  const current = steps[step];

  return (
    <Sheet
      eyebrow={flow === 'welcome' ? 'ARGUS · WELCOME' : `ARGUS · WHAT’S NEW IN ${version}`}
      title={current.title}
      subtitle={current.text}
      width={600}
      onClose={skip}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', width: '100%' }}>
          <Button variant="ghost" onClick={skip}>Skip</Button>
          <div aria-label={`Step ${step + 1} of ${steps.length}`} style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 6 }}>
            {steps.map((s, i) => (
              <span
                key={s.title}
                style={{
                  width: i === step ? 18 : 7,
                  height: 7,
                  borderRadius: 4,
                  background: i === step ? 'var(--accent)' : 'var(--line-3)',
                  transition: 'width .15s',
                }}
              />
            ))}
          </div>
          {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
          <Button
            variant="primary"
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? (flow === 'welcome' ? 'New shell' : 'Done') : 'Next'}
          </Button>
        </div>
      }
    >
      <div style={{ minHeight: 260 }}>{current.body}</div>
    </Sheet>
  );
}

// ── Pictures: small, token-coloured sketches of the real UI ─────────────────

const frame = {
  display: 'flex',
  gap: 10,
  padding: 14,
  minHeight: 180,
  background: 'var(--bg-1)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-3)',
} as const;

const box = (h: number) => ({
  height: h,
  background: 'var(--bg-0)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r-1)',
});

function MiniTabs({ items, on = 0 }: { items: ReactNode[]; on?: number }) {
  return (
    <div style={{ display: 'flex', gap: 10, borderBottom: '1px solid var(--line-2)', fontSize: 11 }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 0',
            marginBottom: -1,
            color: i === on ? 'var(--fg-0)' : 'var(--fg-3)',
            borderBottom: `2px solid ${i === on ? 'var(--accent)' : 'transparent'}`,
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ ...frame, alignItems: 'center', justifyContent: 'center' }}>{children}</div>;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '14px 18px', textAlign: 'center', fontSize: 'var(--t-xs)', color: 'var(--fg-2)',
      background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-3)',
      boxShadow: '0 4px 14px rgba(0,0,0,.08)',
    }}
    >
      {children}
    </div>
  );
}

function HelloPicture() {
  return (
    <Centered>
      <div style={{ display: 'flex', gap: 8 }}>
        {['claude', 'gemini', 'codex'].map((a) => (
          <Card key={a}>
            <AgentGlyph agent={a} size={22} />
            <div style={{ marginTop: 6 }}>running</div>
          </Card>
        ))}
      </div>
    </Centered>
  );
}

function FirstShellPicture() {
  return (
    <div style={{ ...frame, flexDirection: 'column' }}>
      <div style={{ ...box(26), display: 'flex', alignItems: 'center', padding: '0 8px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
        ~/projects/my-app
      </div>
      <MiniTabs items={[<><AgentGlyph agent="claude" size={12} /> Claude Code</>, 'Gemini', 'Codex']} />
      <div style={{ marginTop: 'auto', alignSelf: 'flex-end' }}>
        <Button variant="primary" size="sm">Spawn shell</Button>
      </div>
    </div>
  );
}

// ── What's new: one sketch per beta feature ─────────────────────────────────

/** A one-line row inside a picture: optional leading glyph, name, detail, trailing slot. */
function MiniRow({ lead, name, detail, trail }: { lead?: ReactNode; name: ReactNode; detail?: ReactNode; trail?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
      background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
    }}
    >
      {lead !== undefined && (
        <span style={{
          width: 22, height: 22, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--r-1)', background: 'var(--bg-3)', color: 'var(--fg-2)', fontSize: 'var(--t-tiny)', fontWeight: 600,
        }}
        >
          {lead}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: 'var(--fg-0)' }}>{name}</div>
        {detail && <div style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-2)' }}>{detail}</div>}
      </div>
      {trail}
    </div>
  );
}

const column = { ...frame, flexDirection: 'column', gap: 6 } as const;

const mono = {
  flex: 1, padding: 8, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', lineHeight: 1.6, color: 'var(--fg-2)',
  background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
} as const;

/** A terminal sketch beside a list of labelled events. */
function TermAndFeed({ lines, feed }: { lines: string[]; feed: [string, string][] }) {
  return (
    <div style={frame}>
      <div style={mono}>{lines.map((l) => <div key={l}>{l}</div>)}</div>
      <div style={{ ...mono, fontFamily: 'inherit' }}>
        {feed.map(([k, v]) => (
          <div key={k} style={{ padding: '3px 0', borderBottom: '1px solid var(--line-2)' }}>
            <div style={{ fontWeight: 600, color: 'var(--fg-0)' }}>{k}</div>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

function BetaListPicture() {
  return (
    <div style={column}>
      {BETA_FEATURES.map((f) => {
        const Icon = BETA_SLIDES[f.flag].icon;
        return <MiniRow key={f.flag} lead={<Icon size={13} />} name={f.label} />;
      })}
    </div>
  );
}

function WorktreePicture() {
  return (
    <div style={column}>
      <MiniRow lead={<Check size={13} />} name="Commit" detail="smoke: add f8.txt" />
      <MiniRow lead={<Check size={13} />} name="Push" detail="origin/feat-x" />
      <MiniRow lead="◌" name="Open PR" detail="via gh" />
    </div>
  );
}

function ActivityPicture() {
  return (
    <TermAndFeed
      lines={['❯ run the tests', '● Bash npm test', '● Read src/app.ts', '✻ done']}
      feed={[['Stop', 'waiting for input'], ['Read', 'src/app.ts'], ['Bash', 'npm test'], ['Prompt', 'run the tests']]}
    />
  );
}

function TemplatesPicture() {
  return (
    <Centered>
      <div style={{ width: '100%' }}>
        <MiniRow
          lead={<LayoutGrid size={13} />}
          name="API + client + reviewer"
          detail="3 shells · 2 new worktrees"
          trail={<Button variant="primary" size="sm">Launch</Button>}
        />
      </div>
    </Centered>
  );
}

function HandoffPicture() {
  return (
    <TermAndFeed
      lines={['# Handoff brief', 'branch: feat/login', 'M src/auth.ts  +42 −7', 'last 10 messages…']}
      feed={[['New shell', 'claude · same folder'], ['First prompt', 'Read the brief and continue']]}
    />
  );
}

function ChainsPicture() {
  return (
    <div style={column}>
      <MiniRow lead="A" name="api-tests → idle" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
        <Link size={12} /> types “review the failing tests”
      </div>
      <MiniRow lead="B" name="reviewer" />
    </div>
  );
}

function SummaryPicture({ on }: { on: string[] }) {
  return (
    <div style={column} data-testid="intro-summary">
      {on.length
        ? on.map((label) => <MiniRow key={label} lead={<Check size={13} />} name={label} detail="turned on" />)
        : <MiniRow name="Nothing turned on" detail="All five stay off" />}
    </div>
  );
}
