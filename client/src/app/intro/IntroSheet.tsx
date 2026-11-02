import { useState, type ReactNode } from 'react';
import type { AppConfig, RunMode, SessionViewMode, TerminalEngine } from '@argus/shared';
import {
  CaseSensitive, ChevronDown, MoreHorizontal, FileDiff, Gauge, GitBranch, GitMerge, GitPullRequest,
  GitPullRequestArrow, GitPullRequestDraft, Regex, Search, WholeWord, type LucideIcon,
} from 'lucide-react';
import { Sheet, Button, CodeLine, Icon, Kbd, Tok, Row, Stack, Text, scaledPx } from '../../components/primitives/index.js';
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
  /** What's new: "Open Claude sessions in Chat by default" was ticked. */
  defaultSessionView?: SessionViewMode;
}

interface Step { title: string; text: string; body: ReactNode }

export interface IntroKeys { inspector: string; findInFiles: string }
const DEFAULT_KEYS: IntroKeys = { inspector: '⌘I', findInFiles: '⌘⇧F' };

/**
 * Step-by-step intro: one idea per screen, dots, Back / Next. Skip and Esc
 * still count as seen (the caller stamps `introSeen` either way) so it never
 * comes back on its own; Help → What's New reopens it.
 */
export function IntroSheet({
  flow,
  version,
  config,
  keys = DEFAULT_KEYS,
  onDone,
}: {
  flow: IntroFlow;
  version: string;
  config: Pick<AppConfig, 'defaultRunMode' | 'defaultTerminalEngine'> | null;
  /** Display labels of the shortcuts the slides mention, as the user has them bound. */
  keys?: IntroKeys;
  onDone: (result: IntroResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<TerminalKind>(kindOf(config?.defaultRunMode, config?.defaultTerminalEngine));
  const [makeDefault, setMakeDefault] = useState(true);
  const [chatDefault, setChatDefault] = useState(false);

  const terminalStep: Step = {
    title: 'Pick your terminal',
    text: flow === 'welcome'
      ? 'Choose how new sessions run. Universal is the safe default.'
      : 'Sessions now come in three kinds. Choose the default for new sessions — you can still pick per session.',
    body: (
      <Stack gap={3}>
        <TerminalChoice value={kind} onChange={setKind} />
        <Row as="label" gap={2} style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-1)', cursor: 'pointer' }}>
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          Use {KIND_LABEL[kind]} for new sessions
        </Row>
      </Stack>
    ),
  };

  const steps: Step[] = flow === 'welcome'
    ? [
        {
          title: 'Welcome to Argus',
          text: 'Each session runs a coding agent — Claude, Gemini or Codex — in a folder. Argus tracks their status and tells you when one needs you.',
          body: <HelloPicture />,
        },
        terminalStep,
        {
          title: 'Start your first session',
          text: 'Pick a folder and an agent, then Spawn. ⌘N opens it any time.',
          body: <FirstShellPicture />,
        },
      ]
    : [
        // What's new in this release: one slide per highlight. Bump CURRENT_INTRO_ID with it.
        {
          title: 'Chat view for Claude sessions',
          text: 'In Focus, switch a Claude session between Terminal and Chat. The conversation reads as formatted messages with pasted screenshots inline, slash commands show up in the thread with their output, and the composer formats Markdown as you type. Tick the box below to open Claude shells in Chat by default.',
          body: (
            <Stack gap={3}>
              <ChatPicture />
              <Row as="label" gap={2} style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-1)', cursor: 'pointer' }}>
                <input type="checkbox" checked={chatDefault} onChange={(e) => setChatDefault(e.target.checked)} />
                Open Claude sessions in Chat by default
              </Row>
            </Stack>
          ),
        },
        {
          title: 'Session Inspector',
          text: `A side panel for the session in front of you, with Usage, Git and GitHub cards: plan limits and when they reset, branch and changes, pull requests. Dock it left or right; ${keys.inspector} shows and hides it.`,
          body: <InspectorPicture toggleKey={keys.inspector} />,
        },
        {
          title: 'Your session’s pull requests',
          text: 'The GitHub card lists every pull request the session opened or pushed to. A dot tracks CI and opens the checks, +N −M opens the PR’s diff, Mark ready takes a draft out of draft, and the … menu has the rest.',
          body: <PullRequestsPicture />,
        },
        {
          title: 'Find in Files, highlighted everywhere',
          text: `Press ${keys.findInFiles} in the explorer to search the whole folder with ripgrep — match case, whole word, regex, include and exclude globs. One Shiki highlighter now colours the editor, Chat and diffs alike.`,
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
      // What's new reserves four lines of text, so slides of different lengths
      // keep the same sheet height and the footer buttons stay put.
      subtitle={flow === 'whatsNew' ? <span style={{ display: 'block', minHeight: '4lh' }}>{current.text}</span> : current.text}
      width={600}
      onClose={skip}
      footer={
        <Row gap={2} style={{ width: '100%' }}>
          <Button variant="ghost" onClick={skip}>Skip</Button>
          <Row aria-label={`Step ${step + 1} of ${steps.length}`} grow align="stretch" justify="center" gap={1.5}>
            {steps.map((s, i) => (
              <span
                key={s.title}
                style={{
                  width: i === step ? 18 : 7,
                  height: 7,
                  borderRadius: 'var(--r-2)',
                  background: i === step ? 'var(--accent)' : 'var(--line-3)',
                  transition: 'width var(--dur-fast) var(--ease)',
                }}
              />
            ))}
          </Row>
          {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
          <Button
            variant="primary"
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? (flow === 'welcome' ? 'New session' : 'Done') : 'Next'}
          </Button>
        </Row>
      }
    >
      <div style={{ minHeight: flow === 'whatsNew' ? WHATS_NEW_BODY_HEIGHT : 260 }}>{current.body}</div>
    </Sheet>
  );
}

/** The tallest What's new slide (Chat: screenshot + checkbox), given to every one of them. */
const WHATS_NEW_BODY_HEIGHT = scaledPx(292);

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
    <Row align="stretch" gap={3} style={{ borderBottom: '1px solid var(--line-2)', fontSize: 'var(--t-caption)' }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--s-1)',
            padding: 'var(--s-1) 0',
            marginBottom: 'calc(-1 * var(--s-px))',
            color: i === on ? 'var(--fg-0)' : 'var(--fg-3)',
            borderBottom: `2px solid ${i === on ? 'var(--accent)' : 'transparent'}`,
          }}
        >
          {it}
        </span>
      ))}
    </Row>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ ...frame, alignItems: 'center', justifyContent: 'center' }}>{children}</div>;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: 'var(--s-4) var(--s-4)', textAlign: 'center', fontSize: 'var(--t-xs)', color: 'var(--fg-2)',
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
      <Row align="stretch" gap={2}>
        {['claude', 'gemini', 'codex'].map((a) => (
          <Card key={a}>
            <AgentGlyph agent={a} size={22} />
            <div style={{ marginTop: 'var(--s-1-5)' }}>running</div>
          </Card>
        ))}
      </Row>
    </Centered>
  );
}

function FirstShellPicture() {
  return (
    <div style={{ ...frame, flexDirection: 'column' }}>
      <Row style={{ ...box(26), padding: '0 var(--s-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-caption)', color: 'var(--fg-2)' }}>
        ~/projects/my-app
      </Row>
      <MiniTabs items={[<><AgentGlyph agent="claude" size={12} /> Claude Code</>, 'Gemini', 'Codex']} />
      <div style={{ marginTop: 'auto', alignSelf: 'flex-end' }}>
        <Button variant="primary" size="sm">Start session</Button>
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
      alt="A Claude session in Focus with the Chat view on: a short exchange and the composer"
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
      <Row gap={1.5} style={{ padding: 'var(--s-1-5) var(--s-2)', borderBottom: '1px solid var(--line-2)', fontSize: 'var(--t-xs)', fontWeight: 500, color: 'var(--fg-0)' }}>
        <Icon icon={ChevronDown} size="sm" strokeWidth={2} color="var(--fg-2)" />
        <Icon icon={icon} size="sm" color="var(--fg-2)" />
        {title}
      </Row>
      <Stack gap={2} style={{ padding: 'var(--s-2) var(--s-2)' }}>{children}</Stack>
    </div>
  );
}

/** Usage meter as D3 lays it out: label · % left, reset right, bar below. */
function MiniMeter({ label, pct, aside }: { label: string; pct: number; aside: string }) {
  return (
    <Stack gap={1} style={tiny}>
      <Row align="stretch" justify="between" gap={1.5}>
        <span>
          <Text tone="default" weight={500}>{label}</Text>
          <Text tone="faint"> · </Text>
          <Text weight={600} style={{ color: 'var(--fg-0)' }}>{pct}%</Text>
        </span>
        <Text tone="muted">{aside}</Text>
      </Row>
      <div style={{ height: scaledPx(4), borderRadius: 'var(--r-1)', background: 'var(--bg-3)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ok)' }} />
      </div>
    </Stack>
  );
}

function CiDot({ ci }: { ci: 'success' | 'pending' | 'failure' }) {
  return <span className="argus-pr-ci" data-ci={ci} />;
}

function Lines({ add, del }: { add: string; del: string }) {
  return (
    <Row as="span" gap={1} style={{ ...mono, fontWeight: 500 }}>
      <span style={{ color: 'var(--ok)' }}>+{add}</span>
      <Text tone="danger">−{del}</Text>
      <Icon icon={FileDiff} size="sm" color="var(--fg-3)" />
    </Row>
  );
}

function InspectorPicture({ toggleKey }: { toggleKey: string }) {
  const bars = [70, 46, 82, 58, 34, 64, 50];
  return (
    <div style={frame}>
      <Stack grow gap={2}>
        <MiniTabs items={[<><AgentGlyph agent="claude" size={12} /> my-app</>]} />
        {bars.map((w, i) => (
          <div key={i} style={{ width: `${w}%`, height: scaledPx(6), borderRadius: 'var(--r-2)', background: 'var(--bg-3)' }} />
        ))}
        <Row gap={1.5} style={{ marginTop: 'auto', ...tiny, color: 'var(--fg-2)' }}>
          <Kbd>{toggleKey}</Kbd> show / hide
        </Row>
      </Stack>
      <Stack gap={2} style={{ width: scaledPx(210), flexShrink: 0, paddingLeft: 'var(--s-3)', borderLeft: '1px solid var(--line-2)' }}>
        <PanelCard icon={Gauge} title="Usage">
          <MiniMeter label="Session" pct={43} aside="Resets in 3 hr" />
          <MiniMeter label="Weekly" pct={18} aside="Resets Mon" />
        </PanelCard>
        <PanelCard icon={GitBranch} title="Git">
          <Row align="stretch" justify="between" style={{ ...tiny, ...mono }}>
            <span style={{ color: 'var(--fg-0)' }}>feat/chat-view</span>
            <Text tone="muted">↑2</Text>
          </Row>
          <Text as="div" size="caption" tone="muted">3 changed files</Text>
        </PanelCard>
        <PanelCard icon={GitPullRequest} title="GitHub">
          <Row gap={1.5} style={tiny}>
            <Icon icon={GitPullRequest} size="sm" strokeWidth={2} color="var(--ok)" />
            <span style={{ flex: 1, color: 'var(--fg-0)' }}>Chat view</span>
            <CiDot ci="success" />
          </Row>
        </PanelCard>
      </Stack>
    </div>
  );
}

function PrRow({ icon, tone, title, num, add, del, ci, draft, popover }: {
  icon: LucideIcon;
  tone: string;
  title: string;
  num: number;
  add: string;
  del: string;
  ci: 'success' | 'pending' | 'failure';
  draft?: boolean;
  /** Drawn beside the row's CI dot, as if opened from it. */
  popover?: ReactNode;
}) {
  return (
    <Row align="start" gap={2} style={{ position: 'relative', padding: 'var(--s-2) var(--s-3)', borderTop: '1px solid var(--line-2)', ...tiny }}>
      <Icon icon={icon} size="md" strokeWidth={2} color={tone} style={{ flexShrink: 0, marginTop: 'var(--s-px)' }} />
      <Stack grow gap={1}>
        <Text size="small" style={{ color: 'var(--fg-0)' }}>{title}</Text>
        <Row as="span" gap={2} style={{ color: 'var(--fg-3)' }}>
          <span style={mono}>#{num}</span>
          <Lines add={add} del={del} />
        </Row>
        {draft && (
          <Row
            as="span"
            gap={1}
            style={{
              alignSelf: 'flex-start',
              height: 'var(--ctl-h-sm)', padding: '0 var(--s-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', color: 'var(--fg-1)',
            }}
          >
            <Icon icon={GitPullRequestArrow} size="sm" />
            Mark ready
          </Row>
        )}
      </Stack>
      <Row as="span" gap={2} style={{ height: scaledPx(16) }}>
        <CiDot ci={ci} />
        <Icon icon={MoreHorizontal} size="md" color="var(--fg-3)" />
      </Row>
      {popover}
    </Row>
  );
}

function PullRequestsPicture() {
  return (
    <div style={{ ...frame, alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{ width: scaledPx(330) }}>
        <div style={{ background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)' }}>
          <Row gap={1.5} style={{ padding: 'var(--s-1-5) var(--s-3)', fontSize: 'var(--t-xs)', fontWeight: 500, color: 'var(--fg-0)' }}>
            <Icon icon={GitPullRequest} size="sm" color="var(--fg-2)" />
            GitHub
            <Text size="caption" tone="faint" style={{ marginLeft: 'auto', fontWeight: 400 }}>3 pull requests</Text>
          </Row>
          <PrRow icon={GitPullRequest} tone="var(--ok)" title="Session Inspector" num={59} add="1.2k" del="88" ci="success" />
          <PrRow icon={GitPullRequestDraft} tone="var(--fg-3)" title="What’s new for 0.30" num={55} add="412" del="37" ci="pending" draft popover={<ChecksPopover />} />
          <PrRow icon={GitMerge} tone="var(--pr-merged)" title="Pull request diff" num={58} add="903" del="41" ci="success" />
        </div>
      </div>
    </div>
  );
}

/** The checks popover, opened from the draft's CI dot. */
function ChecksPopover() {
  return (
    <Stack
      gap={1.5}
      style={{
        position: 'absolute', top: 'calc(100% - 6px)', right: 6, width: scaledPx(132), zIndex: 1,
        padding: 'var(--s-2) var(--s-3)',
        background: 'var(--bg-2)', borderRadius: 'var(--r-2)', boxShadow: 'var(--shadow-pop)', ...tiny,
      }}
    >
      <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>Checks</span>
      {([['pending', 'Pending', 1], ['success', 'Passed', 6]] as const).map(([ci, label, n]) => (
        <Row as="span" key={ci} gap={1.5} style={{ color: 'var(--fg-1)' }}>
          <CiDot ci={ci} />
          <span style={{ flex: 1 }}>{label}</span>
          <Text mono tone="muted">{n}</Text>
        </Row>
      ))}
    </Stack>
  );
}

/** One result line, the match marked as FindInFilesPanel marks it. */
function Match({ line, before, hit, after, on }: { line: number; before: string; hit: string; after: string; on?: boolean }) {
  return (
    <Row
      gap={1.5}
      style={{
        minHeight: scaledPx(20), padding: '0 var(--s-1-5) 0 var(--s-5)', ...mono, fontSize: 'var(--t-tiny)',
        background: on ? 'var(--bg-3)' : 'transparent', borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      <Text tone="faint" style={{ minWidth: '3ch', textAlign: 'right' }}>{line}</Text>
      <span style={{ color: 'var(--fg-1)', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {before}
        <mark style={{ background: 'var(--accent-bg)', color: 'var(--accent)', outline: '1px solid var(--accent-edge)', borderRadius: 'var(--r-1)' }}>{hit}</mark>
        {after}
      </span>
    </Row>
  );
}

function FindPicture() {
  return (
    <div style={{ ...frame, padding: 0, gap: 0, overflow: 'hidden' }}>
      <Stack style={{ width: scaledPx(236), flexShrink: 0, borderRight: '1px solid var(--line-2)' }}>
        <Stack gap={1.5} style={{ padding: 'var(--s-2)', borderBottom: '1px solid var(--line-2)' }}>
          <Text mono size="caption" tone="faint" style={{ letterSpacing: 'var(--tracking-eye)' }}>FIND IN FILES</Text>
          <Row gap={1} style={{ height: 'var(--ctl-h-sm)', padding: '0 var(--s-1-5)', background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)' }}>
            <Icon icon={Search} size="sm" color="var(--fg-3)" />
            <Text mono size="small" style={{ flex: 1, color: 'var(--fg-0)' }}>useSocket</Text>
            {[CaseSensitive, WholeWord, Regex].map((g, i) => <Icon key={i} icon={g} size="sm" color="var(--fg-3)" />)}
          </Row>
          <Text mono size="caption" tone="faint">5 results in 2 files</Text>
        </Stack>
        <Row gap={1.5} style={{ minHeight: scaledPx(20), padding: '0 var(--s-2) 0 var(--s-1-5)', ...mono, fontSize: 'var(--t-tiny)' }}>
          <Icon icon={ChevronDown} size="sm" color="var(--fg-3)" />
          <span style={{ color: 'var(--fg-0)' }}>useSessions.ts</span>
          <Text tone="faint" style={{ flex: 1 }}>hooks</Text>
          <Text tone="muted" style={{ background: 'var(--bg-3)', borderRadius: 'var(--r-1)', padding: '0 var(--s-1-5)' }}>3</Text>
        </Row>
        <Match line={2} before="import { " hit="useSocket" after=" } from" />
        <Match line={14} before="const s = " hit="useSocket" after="();" on />
        <Match line={41} before="// " hit="useSocket" after=" reconnects" />
      </Stack>
      <Stack grow gap={1} style={{ padding: 'var(--s-3) var(--s-1)', background: 'var(--bg-0)' }}>
        <CodeLine n={13}><Tok kind="kw">export function</Tok> <Tok kind="fn">useSessions</Tok><Tok kind="pn">() {'{'}</Tok></CodeLine>
        <CodeLine n={14}>{'\u00a0\u00a0'}<Tok kind="kw">const</Tok> s <Tok kind="pn">=</Tok> <Tok kind="fn">useSocket</Tok><Tok kind="pn">();</Tok></CodeLine>
        <CodeLine n={15}>{'\u00a0\u00a0'}<Tok kind="cm">{'// one highlighter, every view'}</Tok></CodeLine>
        <CodeLine n={16}>{'\u00a0\u00a0'}<Tok kind="kw">return</Tok> s<Tok kind="pn">.</Tok><Tok kind="fn">list</Tok><Tok kind="pn">(</Tok><Tok kind="str">{"'sessions'"}</Tok><Tok kind="pn">,</Tok> <Tok kind="num">50</Tok><Tok kind="pn">);</Tok></CodeLine>
        <Text as="div" mono size="caption" tone="faint" style={{ margin: 'var(--s-2) var(--s-2) 0', paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line-2)' }}>diff</Text>
        <div style={{ background: 'var(--diff-del)' }}>
          <CodeLine n="−"><Tok kind="kw">const</Tok> limit <Tok kind="pn">=</Tok> <Tok kind="num">20</Tok><Tok kind="pn">;</Tok></CodeLine>
        </div>
        <div style={{ background: 'var(--diff-add)' }}>
          <CodeLine n="+"><Tok kind="kw">const</Tok> limit <Tok kind="pn">=</Tok> <Tok kind="num">50</Tok><Tok kind="pn">;</Tok></CodeLine>
        </div>
      </Stack>
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
      <Row align="stretch" gap={6}>
        {ICON_STYLES.map(({ label, src }) => (
          <Stack key={label} align="center" gap={2}>
            <img src={src} alt={`Argus icon, ${label} style`} style={{ width: scaledPx(72), height: scaledPx(72) }} />
            <Text size="small" tone="default">{label}</Text>
          </Stack>
        ))}
      </Row>
    </Centered>
  );
}
