import { useState, type ReactNode } from 'react';
import type { AppConfig, RunMode, TerminalEngine } from '@argus/shared';
import { RotateCcw } from 'lucide-react';
import { Sheet, Button } from '../../components/primitives/index.js';
import { TerminalChoice } from '../ui/TerminalChoice.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { KIND_LABEL, kindOf, settingsFor, type TerminalKind } from '../ui/terminalKind.js';
import type { IntroFlow } from './intro.js';

export interface IntroResult {
  /** Present when the user kept "Use … for new shells" ticked on the terminal step. */
  defaults?: { runMode: RunMode; terminalEngine: TerminalEngine };
  /** Welcome's last button: open the New shell sheet after closing. */
  openCreate?: boolean;
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
        terminalStep,
        {
          title: 'A clearer New shell sheet',
          text: 'Two columns: folder, agent and flags on the left; terminal and isolation on the right. Agents are tabs now.',
          body: <SheetPicture />,
        },
        {
          title: 'Stopped sessions explain themselves',
          text: 'A stopped tile shows a Restart card, and quitting asks first before it stops Native sessions.',
          body: <StoppedPicture />,
        },
      ];

  const last = step === steps.length - 1;
  const finish = (openCreate: boolean) => onDone({
    defaults: makeDefault ? settingsFor(kind) : undefined,
    openCreate,
  });
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
            onClick={() => (last ? finish(flow === 'welcome') : setStep(step + 1))}
          >
            {last ? (flow === 'welcome' ? 'New shell' : 'Got it') : 'Next'}
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

function SheetPicture() {
  return (
    <div style={frame}>
      <div style={{ flex: 1.25, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={box(18)} />
        <div style={box(18)} />
        <MiniTabs items={['Claude', 'Gemini', 'Codex']} />
        <div style={box(18)} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MiniTabs items={['Universal', 'Advanced', 'Native']} />
        <div style={box(44)} />
        <div style={box(30)} />
      </div>
    </div>
  );
}

function StoppedPicture() {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ ...frame, flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Card>
          <div style={{ fontWeight: 600, color: 'var(--fg-0)', marginBottom: 8 }}>Session stopped</div>
          <Button variant="primary" size="sm" icon={RotateCcw}>Restart</Button>
        </Card>
      </div>
      <div style={{ ...frame, flex: 1.2, alignItems: 'center', justifyContent: 'center' }}>
        <Card>
          <div style={{ fontWeight: 600, color: 'var(--fg-0)', marginBottom: 4 }}>Quit and stop 2 sessions?</div>
          They’ll stay in your list with a Restart button.
        </Card>
      </div>
    </div>
  );
}
