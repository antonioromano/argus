import { useState, type ReactNode } from 'react';
import type { AppConfig, BetaFlag, RunMode, SessionViewMode, TerminalEngine } from '@argus/shared';
import {
  CaseSensitive, ChevronDown, Ellipsis, FileDiff, Gauge, GitBranch, GitMerge, GitPullRequest,
  GitPullRequestArrow, GitPullRequestDraft, Regex, Search, WholeWord, type LucideIcon,
} from 'lucide-react';
import { Sheet, Button, CodeLine, Icon, Kbd, Tok, scaledPx } from '../../components/primitives/index.js';
import { TerminalChoice } from '../ui/TerminalChoice.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { KIND_LABEL, kindOf, settingsFor, type TerminalKind } from '../ui/terminalKind.js';
import type { IntroFlow } from './intro.js';
import chatViewShot from './assets/chat-view.webp';
import appIconDefault from './assets/app-icon-default.webp';
import appIconDark from './assets/app-icon-dark.webp';
import appIconTinted from './assets/app-icon-tinted.webp';
import appIconClear from './assets/app-icon-clear.webp';

export interface IntroResult {
  /** Present when the user kept "Use … for new shells" ticked on the terminal step. */
  defaults?: { runMode: RunMode; terminalEngine: TerminalEngine };
  /** Welcome's last button: open the New shell sheet after closing. */
  openCreate?: boolean;
  /** Beta features to switch on (no What's new step offers this right now). */
  betaFlags?: Partial<Record<BetaFlag, true>>;
  /** What's new: "Open Claude shells in Chat by default" was ticked. */
  defaultSessionView?: SessionViewMode;
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
  const [chatDefault, setChatDefault] = useState(false);

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
        // What's new in this release: one slide per highlight. Bump CURRENT_INTRO_ID with it.
        {
          title: 'Chat view for Claude shells',
          text: 'In Focus, switch a Claude shell between Terminal and Chat. The conversation reads as formatted messages with pasted screenshots inline, slash commands show up in the thread with their output, and the composer formats Markdown as you type. Tick the box below to open Claude shells in Chat by default.',
          body: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
              <ChatPicture />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-sm)', color: 'var(--fg-1)', cursor: 'pointer' }}>
                <input type="checkbox" checked={chatDefault} onChange={(e) => setChatDefault(e.target.checked)} />
                Open Claude shells in Chat by default
              </label>
            </div>
          ),
        },
        {
          title: 'Session Inspector',
          text: 'A side panel for the shell in front of you, with Usage, Git and GitHub cards: plan limits and when they reset, branch and changes, pull requests. Dock it left or right; ⌘I shows and hides it.',
          body: <InspectorPicture />,
        },
        {
          title: 'Your session’s pull requests',
          text: 'The GitHub card lists every pull request the session opened or pushed to. A dot tracks CI and opens the checks, +N −M opens the PR’s diff, Mark ready takes a draft out of draft, and the … menu has the rest.',
          body: <PullRequestsPicture />,
        },
        {
          title: 'Find in Files, highlighted everywhere',
          text: 'Press ⌘⇧F in the explorer to search the whole folder with ripgrep — match case, whole word, regex, include and exclude globs. One Shiki highlighter now colours the editor, Chat and diffs alike.',
          body: <FindPicture />,
        },
        {
          title: 'An icon for every macOS style',
          text: 'The Argus icon is now a layered macOS icon, so it follows the icon style you pick in System Settings → Appearance: Default, Dark with the amber glyph, Tinted and Clear.',
          body: <AppIconPicture />,
        },
      ];

  const last = step === steps.length - 1;
  // The box starts unticked and only ever turns Chat on; Done, Skip and Esc all
  // honour a tick, since ticking it is an explicit choice.
  const whatsNewResult = (): IntroResult => (flow === 'whatsNew' && chatDefault ? { defaultSessionView: 'chat' } : {});
  const finish = () => {
    if (flow === 'welcome') {
      onDone({ defaults: makeDefault ? settingsFor(kind) : undefined, openCreate: true });
      return;
    }
    onDone(whatsNewResult());
  };
  const skip = () => onDone(whatsNewResult());
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

// ── What's new ──────────────────────────────────────────────────────────────

/** A real Focus screenshot (dark theme, 2x). */
function ChatPicture() {
  return (
    <img
      src={chatViewShot}
      alt="A Claude shell in Focus with the Chat view on: a short exchange and the composer"
      style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid var(--line-2)', borderRadius: 'var(--r-3)' }}
    />
  );
}

// Sketches of the Session Inspector, its GitHub card and Find in Files. They
// borrow the real components' tokens (meter colours, CI dots, +N −M, match
// highlight), so they follow the theme like the UI they stand for.

const tiny = { fontSize: 'var(--t-tiny)' } as const;
const mono = { fontFamily: 'var(--font-mono)' } as const;

/** A collapsible inspector section, drawn open. */
function PanelCard({ icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderBottom: '1px solid var(--line-2)', fontSize: 'var(--t-xs)', fontWeight: 500, color: 'var(--fg-0)' }}>
        <Icon icon={ChevronDown} size={11} strokeWidth={2} color="var(--fg-2)" />
        <Icon icon={icon} size={12} strokeWidth={1.8} color="var(--fg-2)" />
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '7px 8px' }}>{children}</div>
    </div>
  );
}

/** Usage meter as D3 lays it out: label · % left, reset right, bar below. */
function MiniMeter({ label, pct, aside }: { label: string; pct: number; aside: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...tiny }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>
          <span style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{label}</span>
          <span style={{ color: 'var(--fg-3)' }}> · </span>
          <span style={{ color: 'var(--fg-0)', fontWeight: 600 }}>{pct}%</span>
        </span>
        <span style={{ color: 'var(--fg-2)' }}>{aside}</span>
      </div>
      <div style={{ height: scaledPx(4), borderRadius: 2, background: 'var(--bg-3)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ok)' }} />
      </div>
    </div>
  );
}

function CiDot({ ci }: { ci: 'success' | 'pending' | 'failure' }) {
  return <span className="argus-pr-ci" data-ci={ci} />;
}

function Lines({ add, del }: { add: string; del: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...mono, fontWeight: 500 }}>
      <span style={{ color: 'var(--ok)' }}>+{add}</span>
      <span style={{ color: 'var(--danger)' }}>−{del}</span>
      <Icon icon={FileDiff} size={11} strokeWidth={1.8} color="var(--fg-3)" />
    </span>
  );
}

function InspectorPicture() {
  const bars = [70, 46, 82, 58, 34, 64, 50];
  return (
    <div style={frame}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <MiniTabs items={[<><AgentGlyph agent="claude" size={12} /> my-app</>]} />
        {bars.map((w, i) => (
          <div key={i} style={{ width: `${w}%`, height: scaledPx(6), borderRadius: 3, background: 'var(--bg-3)' }} />
        ))}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6, ...tiny, color: 'var(--fg-2)' }}>
          <Kbd>⌘I</Kbd> show / hide
        </div>
      </div>
      <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 10, borderLeft: '1px solid var(--line-2)' }}>
        <PanelCard icon={Gauge} title="Usage">
          <MiniMeter label="Session" pct={43} aside="Resets in 3 hr" />
          <MiniMeter label="Weekly" pct={18} aside="Resets Mon" />
        </PanelCard>
        <PanelCard icon={GitBranch} title="Git">
          <div style={{ display: 'flex', justifyContent: 'space-between', ...tiny, ...mono }}>
            <span style={{ color: 'var(--fg-0)' }}>feat/chat-view</span>
            <span style={{ color: 'var(--fg-2)' }}>↑2</span>
          </div>
          <div style={{ ...tiny, color: 'var(--fg-2)' }}>3 changed files</div>
        </PanelCard>
        <PanelCard icon={GitPullRequest} title="GitHub">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...tiny }}>
            <Icon icon={GitPullRequest} size={12} strokeWidth={2} color="var(--ok)" />
            <span style={{ flex: 1, color: 'var(--fg-0)' }}>Chat view</span>
            <CiDot ci="success" />
          </div>
        </PanelCard>
      </div>
    </div>
  );
}

function PrRow({ icon, tone, title, num, add, del, ci, draft }: {
  icon: LucideIcon;
  tone: string;
  title: string;
  num: number;
  add: string;
  del: string;
  ci: 'success' | 'pending' | 'failure';
  draft?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', borderTop: '1px solid var(--line-2)', ...tiny }}>
      <Icon icon={icon} size={14} strokeWidth={2} color={tone} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-0)' }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-3)' }}>
          <span style={mono}>#{num}</span>
          <Lines add={add} del={del} />
        </span>
        {draft && (
          <span style={{
            alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 'var(--ctl-h-sm)', padding: '0 var(--s-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', color: 'var(--fg-1)',
          }}
          >
            <Icon icon={GitPullRequestArrow} size={12} strokeWidth={1.8} />
            Mark ready
          </span>
        )}
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: scaledPx(16) }}>
        <CiDot ci={ci} />
        <Icon icon={Ellipsis} size={13} strokeWidth={1.8} color="var(--fg-3)" />
      </span>
    </div>
  );
}

function PullRequestsPicture() {
  return (
    <div style={{ ...frame, alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 330 }}>
        <div style={{ background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 'var(--t-xs)', fontWeight: 500, color: 'var(--fg-0)' }}>
            <Icon icon={GitPullRequest} size={12} strokeWidth={1.8} color="var(--fg-2)" />
            GitHub
            <span style={{ marginLeft: 'auto', ...tiny, fontWeight: 400, color: 'var(--fg-3)' }}>3 pull requests</span>
          </div>
          <PrRow icon={GitPullRequest} tone="var(--ok)" title="Session Inspector" num={59} add="1.2k" del="88" ci="success" />
          <PrRow icon={GitPullRequestDraft} tone="var(--fg-3)" title="What’s new for 0.30" num={55} add="412" del="37" ci="pending" draft />
          <PrRow icon={GitMerge} tone="var(--pr-merged)" title="Pull request diff" num={58} add="903" del="41" ci="success" />
        </div>
        {/* The checks popover, opened from the draft's CI dot. */}
        <div style={{
          position: 'absolute', top: 96, left: 'calc(100% - 18px)', width: 132,
          display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px',
          background: 'var(--bg-2)', borderRadius: 'var(--r-2)', boxShadow: 'var(--shadow-pop)', ...tiny,
        }}
        >
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>Checks</span>
          {([['pending', 'Pending', 1], ['success', 'Passed', 6]] as const).map(([ci, label, n]) => (
            <span key={ci} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-1)' }}>
              <CiDot ci={ci} />
              <span style={{ flex: 1 }}>{label}</span>
              <span style={{ ...mono, color: 'var(--fg-2)' }}>{n}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One result line, the match marked as FindInFilesPanel marks it. */
function Match({ line, before, hit, after, on }: { line: number; before: string; hit: string; after: string; on?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, minHeight: scaledPx(20), padding: '0 6px 0 22px', ...mono, fontSize: 'var(--t-tiny)',
      background: on ? 'var(--bg-3)' : 'transparent', borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
    }}
    >
      <span style={{ color: 'var(--fg-3)', minWidth: '3ch', textAlign: 'right' }}>{line}</span>
      <span style={{ color: 'var(--fg-1)', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {before}
        <mark style={{ background: 'var(--accent-bg)', color: 'var(--accent)', outline: '1px solid var(--accent-edge)', borderRadius: 2 }}>{hit}</mark>
        {after}
      </span>
    </div>
  );
}

function FindPicture() {
  return (
    <div style={{ ...frame, padding: 0, gap: 0, overflow: 'hidden' }}>
      <div style={{ width: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px', borderBottom: '1px solid var(--line-2)' }}>
          <span style={{ ...mono, ...tiny, letterSpacing: 'var(--tracking-eye)', color: 'var(--fg-3)' }}>FIND IN FILES</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 'var(--ctl-h-sm)', padding: '0 6px', background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)' }}>
            <Icon icon={Search} size={12} strokeWidth={1.6} color="var(--fg-3)" />
            <span style={{ flex: 1, ...mono, fontSize: 'var(--t-xs)', color: 'var(--fg-0)' }}>useSocket</span>
            {[CaseSensitive, WholeWord, Regex].map((g, i) => <Icon key={i} icon={g} size={12} strokeWidth={1.6} color="var(--fg-3)" />)}
          </div>
          <span style={{ ...mono, ...tiny, color: 'var(--fg-3)' }}>5 results in 2 files</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: scaledPx(20), padding: '0 8px 0 6px', ...mono, fontSize: 'var(--t-tiny)' }}>
          <Icon icon={ChevronDown} size={11} strokeWidth={1.6} color="var(--fg-3)" />
          <span style={{ color: 'var(--fg-0)' }}>useSessions.ts</span>
          <span style={{ flex: 1, color: 'var(--fg-3)' }}>hooks</span>
          <span style={{ color: 'var(--fg-2)', background: 'var(--bg-3)', borderRadius: 'var(--r-1)', padding: '0 5px' }}>3</span>
        </div>
        <Match line={2} before="import { " hit="useSocket" after=" } from" />
        <Match line={14} before="const s = " hit="useSocket" after="();" on />
        <Match line={41} before="// " hit="useSocket" after=" reconnects" />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 4px', background: 'var(--bg-0)' }}>
        <CodeLine n={13}><Tok kind="kw">export function</Tok> <Tok kind="fn">useSessions</Tok><Tok kind="pn">() {'{'}</Tok></CodeLine>
        <CodeLine n={14}>{'\u00a0\u00a0'}<Tok kind="kw">const</Tok> s <Tok kind="pn">=</Tok> <Tok kind="fn">useSocket</Tok><Tok kind="pn">();</Tok></CodeLine>
        <CodeLine n={15}>{'\u00a0\u00a0'}<Tok kind="cm">{'// one highlighter, every view'}</Tok></CodeLine>
        <CodeLine n={16}>{'\u00a0\u00a0'}<Tok kind="kw">return</Tok> s<Tok kind="pn">.</Tok><Tok kind="fn">list</Tok><Tok kind="pn">(</Tok><Tok kind="str">{"'sessions'"}</Tok><Tok kind="pn">,</Tok> <Tok kind="num">50</Tok><Tok kind="pn">);</Tok></CodeLine>
        <div style={{ margin: '8px 8px 0', paddingTop: 8, borderTop: '1px solid var(--line-2)', ...tiny, ...mono, color: 'var(--fg-3)' }}>diff</div>
        <div style={{ background: 'var(--diff-del)' }}>
          <CodeLine n="−"><Tok kind="kw">const</Tok> limit <Tok kind="pn">=</Tok> <Tok kind="num">20</Tok><Tok kind="pn">;</Tok></CodeLine>
        </div>
        <div style={{ background: 'var(--diff-add)' }}>
          <CodeLine n="+"><Tok kind="kw">const</Tok> limit <Tok kind="pn">=</Tok> <Tok kind="num">50</Tok><Tok kind="pn">;</Tok></CodeLine>
        </div>
      </div>
    </div>
  );
}

/**
 * The app icon in four macOS styles, exported from electron/assets/Argus.icon
 * with Icon Composer's ictool (144px WebP) — the system's own renderings,
 * so they keep their colours whatever theme Argus uses.
 */
const ICON_STYLES = [
  { label: 'Default', src: appIconDefault },
  { label: 'Dark', src: appIconDark },
  { label: 'Tinted', src: appIconTinted },
  { label: 'Clear', src: appIconClear },
];

function AppIconPicture() {
  return (
    <Centered>
      <div style={{ display: 'flex', gap: 24 }}>
        {ICON_STYLES.map(({ label, src }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <img src={src} alt={`Argus icon, ${label} style`} style={{ width: scaledPx(72), height: scaledPx(72) }} />
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-1)' }}>{label}</span>
          </div>
        ))}
      </div>
    </Centered>
  );
}
