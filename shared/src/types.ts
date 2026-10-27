export type SessionStatus = 'waiting' | 'running' | 'idle' | 'done' | 'exited';

// How a waiting-for-input shell stands out in the mosaic grid.
export type MosaicWaitingStyle = 'breathing' | 'flag';

// How mosaic tiles are arranged: side by side in columns, or stacked in rows.
export type MosaicOrientation = 'horizontal' | 'vertical';

export type BuiltinAgentId = 'claude' | 'gemini' | 'codex' | 'shell';
export type AgentType = BuiltinAgentId | string;

/** Agent id of the plain login shell: a session with no AI attached. It never
 *  reports 'waiting' or 'done' — only running (output streaming) / idle / exited. */
export const SHELL_AGENT_ID = 'shell';

/** Which terminal implementation renders a session. `web` (xterm.js) is the
 *  default and the universal fallback; `native` is a macOS-only preference that
 *  silently degrades to `web` on mobile, off-Electron, off-macOS, or if the
 *  native addon fails to load. */
export type TerminalEngine = 'web' | 'native';

/** How a session's agent process is hosted. `persistent` lives in the argusd
 *  daemon (or tmux) and survives an Argus quit; `direct` is spawned by the
 *  server with plain node-pty, like the ⌘T shell, and stops when Argus quits. */
export type RunMode = 'persistent' | 'direct';

/** Native lifecycle states an agent CLI can report (subset of SessionStatus).
 *  'done'/'exited' are Argus-level promotions, never reported natively. */
export type AgentSignalState = 'running' | 'waiting' | 'idle';

/** Canonical native lifecycle signal, after per-agent mapping. The ingestion
 *  route builds this from a validated request and hands it to the arbiter. */
export interface AgentSignal {
  sessionId: string;
  state: AgentSignalState;
  /** Native prompt/question text (e.g. Claude Notification.message); preferred over screen scraping. */
  promptText?: string;
  source: 'native';
  /** Raw payload — kept only in diagnostics, never trusted for control flow. */
  raw?: unknown;
}

/** Opt-in native-signal config for a custom agent (built-ins use their adapter). */
export interface AgentStateSignalConfig {
  mechanism: 'claude-hooks' | 'gemini-hooks' | 'codex-notify';
  /** States this mechanism reports; the arbiter suppresses heuristics only for these. */
  coverage: AgentSignalState[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  builtin: boolean;
  installCommand?: string;
  installUrl?: string;
  /** Optional opt-in to native state signals (custom agents). */
  stateSignals?: AgentStateSignalConfig;
  /** Custom agents: flag that carries an initial prompt (e.g. "-i"). Built-ins need none. */
  promptFlag?: string;
}

export interface AgentFlag {
  id: string;        // crypto.randomUUID()
  value: string;     // e.g. "--model opus-4", "--verbose"
  enabled: boolean;  // sticky default (last-used state per agent)
}

/** Action pinned in every mosaic tile header, next to the permanent window controls. */
export type TileQuickAction =
  | 'diff'
  | 'files'
  | 'shell'
  | 'clone'
  | 'restart'
  | 'done'
  | 'apply'
  | 'none';

/** How a running shell signals progress in its tile header. */
export type TileRunningIndicator = 'hairline' | 'off';

/** Session Inspector placement: the left sidebar or a right-hand column. */
export type InspectorSide = 'left' | 'right';

export interface AppConfig {
  defaultAgent: AgentType;
  customAgents: AgentDefinition[];
  agentFlags: Record<string, AgentFlag[]>;  // keyed by agent ID
  notificationsEnabled: boolean;
  notifyOnWaiting: boolean;  // notify when a session needs user input
  notifyOnDone: boolean;     // notify when a session finishes a run
  notifyOnPrChecks?: boolean; // C1: notify when a session PR's checks finish (pending → passed / failed)
  notificationSound: boolean; // play the default system sound with each notification
  showClock?: boolean;        // show HH:MM clock in the toolbar
  clockShowSeconds?: boolean; // extend clock to HH:MM:SS
  othersFolderName?: string;  // display name for the ungrouped-sessions bucket
  preventSleepWhileRunning?: boolean; // keep macOS awake while ≥1 shell is running
  confirmCloseShell?: boolean; // show the confirm modal before closing a shell (Cmd+W / card button)
  exitSessionsOnQuit?: boolean; // when true, plain Cmd+Q kills all sessions instead of detaching (default: preserve)
  confirmExitOnQuit?: boolean; // show the confirm dialog before exiting all sessions on Cmd+Q (default: true)
  keyboardShortcuts?: Record<string, string>; // action id -> combo override (e.g. "command-palette": "mod+shift+k")
  uiFontSize?: number;   // base font size (px) for the interface chrome (default: 14)
  codeFontSize?: number; // base font size (px) for code surfaces: terminals, file viewer, diffs (default: 13)
  mosaicWaitingStyle?: MosaicWaitingStyle; // how a waiting-for-input shell stands out in the mosaic (default: breathing)
  mosaicOrientation?: MosaicOrientation; // side by side ('horizontal') or stacked ('vertical') mosaic tiles (default: horizontal)
  debugToolsEnabled?: boolean; // reveal developer/debug CTAs (e.g. per-session diagnostics dump) (default: false)
  // Process-survival backend: 'auto' = argusd daemon when available (default),
  // 'tmux' = force the legacy tmux backend. Read once at startup — changing it
  // needs an app restart (running sessions are bound to their backend).
  ptyBackend?: 'auto' | 'tmux';
  // Mosaic tile header: the one configurable action pinned beside the permanent
  // minimize/expand controls (default: 'diff'). Everything else lives in the ⋯ menu.
  tileQuickAction?: TileQuickAction;
  // 2px progress hairline under the header while an agent is working (default: 'hairline').
  tileRunningIndicator?: TileRunningIndicator;
  // Version that already showed the quick-action picker. Empty/absent ⇒ show it on
  // next launch. A version string (not a bool) so a future release can re-ask
  // without a config migration.
  quickActionPromptedAt?: string;
  /** Id of the last What's new / Welcome intro the user finished or skipped.
   *  Empty = never seen one. Bookkeeping, not a preference. */
  introSeen?: string;
  // App-wide default for sessions with no per-session terminalEngine choice.
  defaultTerminalEngine?: TerminalEngine;
  // Run mode for new sessions when the Create sheet doesn't override it.
  defaultRunMode?: RunMode;
  // Ask before ⌘Q stops running direct sessions.
  confirmQuitDirectSessions?: boolean;
  // Launch links outside these roots get a warning on the approval card.
  launchFolderRoots?: string[];
  // Usage meter master switch: context % / plan usage chip on Claude and Codex shell headers (default: true).
  showUsageMeter?: boolean;
  // What the usage chip shows, in order; each id exactly once (default: context + plan usage).
  usageMeterParts?: UsageMeterPart[];
  // Chip turns amber, then red, as a shell's context fills (percent, 5..99, red > amber).
  usageWarnContext?: UsageWarnThresholds;
  // Chip turns amber, then red, as plan usage nears the limit (percent, 5..99, red > amber).
  usageWarnPlan?: UsageWarnThresholds;
  // PR / CI chip on shells whose branch has a GitHub PR (via `gh`; default: true).
  showPrStatus?: boolean;
  // Where the Session Inspector (usage, git, GitHub of the shown shell) sits:
  // in the left sidebar, or as a right-hand column (default: 'left').
  inspectorSide?: InspectorSide;
  // Show the Session Inspector at all (default: true). Hidden, the shell
  // header shows usage, git and PR as chips again.
  inspectorVisible?: boolean;
  // Its width in px when docked as a right-hand column (220..560).
  inspectorWidth?: number;
  // Ids of the inspector sections the user collapsed (default: none).
  inspectorCollapsed?: string[];
  // F5: let per-folder rules auto-approve tool calls via the PreToolUse hook (default: false).
  autoApprovalEnabled?: boolean;
  // How Claude sessions draw their UI (default: 'fullscreen'). Applied at spawn,
  // so it reaches new and restarted sessions only.
  claudeRenderer?: ClaudeRenderer;
  // Which view a Claude shell opens in when it has no per-session choice
  // (default: 'terminal'). Other agents always use the terminal.
  defaultSessionView?: SessionViewMode;
  // Beta features (Settings → Beta features). All default off; while a flag is
  // off its feature is inert — no UI, no polling, no timers. See BetaFlag.
  betaActivityTimeline?: boolean; // F6
  betaWorktreeLifecycle?: boolean; // F8
  betaSessionTemplates?: boolean; // F10
  betaHandoff?: boolean; // F12
  betaSessionChains?: boolean; // F13
}

/** A usage chip part: context %, plan usage (+ reset), session tokens, model. */
export type UsageMeterPartId = 'ctx' | 'plan' | 'tok' | 'model';
export const USAGE_METER_PART_IDS: readonly UsageMeterPartId[] = ['ctx', 'plan', 'tok', 'model'];

export interface UsageMeterPart {
  id: UsageMeterPartId;
  on: boolean;
}

/** Warning thresholds in percent: amber at `amber`, red at `red` (5..99, red > amber). */
export interface UsageWarnThresholds {
  amber: number;
  red: number;
}

/** The AppConfig keys that gate a beta feature. Each side reads them through its
 *  own tiny helper (client `utils/betaFlags`, server `utils/betaFlags`) — the
 *  server may only `import type` from here. */
export type BetaFlag =
  | 'betaActivityTimeline'
  | 'betaWorktreeLifecycle'
  | 'betaSessionTemplates'
  | 'betaHandoff'
  | 'betaSessionChains';

/**
 * Claude Code's terminal renderer for sessions Argus spawns.
 *  - fullscreen: alt-screen renderer; a resize re-lays out its own history, so
 *    nothing stale reaches the terminal scrollback (no duplicated messages).
 *  - classic: main-screen renderer with native scrollback; a width change makes
 *    Claude reprint its transcript, leaving copies wrapped for the old width.
 *  - inherit: Argus sets nothing; the user's own `tui` setting applies.
 */
export type ClaudeRenderer = 'fullscreen' | 'classic' | 'inherit';

/** How a Claude shell is shown: the raw terminal or the Chat view (B1). */
export type SessionViewMode = 'terminal' | 'chat';

/** Every AppConfig key with its shipped default. The single source of truth for
 *  both the server store (a partial file is merged over this) and the settings
 *  UI, which diffs live config against it to mark modified values. */
export const DEFAULT_CONFIG: AppConfig = {
  defaultAgent: 'claude',
  customAgents: [],
  agentFlags: {},
  notificationsEnabled: false,
  notifyOnWaiting: true,
  notifyOnDone: false,
  notifyOnPrChecks: true,
  notificationSound: false,
  showClock: false,
  clockShowSeconds: false,
  othersFolderName: 'Others',
  preventSleepWhileRunning: false,
  confirmCloseShell: true,
  exitSessionsOnQuit: false,
  confirmExitOnQuit: true,
  keyboardShortcuts: {},
  uiFontSize: 14,
  codeFontSize: 13,
  mosaicWaitingStyle: 'breathing',
  mosaicOrientation: 'horizontal',
  debugToolsEnabled: false,
  ptyBackend: 'auto',
  tileQuickAction: 'diff',
  tileRunningIndicator: 'hairline',
  quickActionPromptedAt: '',
  introSeen: '',
  defaultTerminalEngine: 'web',
  defaultRunMode: 'persistent',
  confirmQuitDirectSessions: true,
  launchFolderRoots: ['~/development'],
  showUsageMeter: true,
  usageMeterParts: [{ id: 'ctx', on: true }, { id: 'plan', on: true }, { id: 'tok', on: false }, { id: 'model', on: false }],
  usageWarnContext: { amber: 70, red: 90 },
  usageWarnPlan: { amber: 80, red: 95 },
  showPrStatus: true,
  inspectorSide: 'left',
  inspectorVisible: true,
  inspectorWidth: 300,
  inspectorCollapsed: [],
  autoApprovalEnabled: false,
  claudeRenderer: 'fullscreen',
  defaultSessionView: 'terminal',
  betaActivityTimeline: false,
  betaWorktreeLifecycle: false,
  betaSessionTemplates: false,
  betaHandoff: false,
  betaSessionChains: false,
};

export interface AgentStatus {
  agent: AgentDefinition;
  installed: boolean;
  resolvedPath?: string;
}

export interface LaunchRequest {
  agent: string;
  folder: string;
  flags: string[];
  prompt?: string;
  engine?: TerminalEngine;
  mode?: RunMode;
  name?: string;
  worktree?: string;
  base?: string;
}

export type LaunchWarningKind = 'worktree' | 'folder-outside-roots' | 'folder-agent-config' | 'launcher-changed' | 'risky-flag';

export interface LaunchWarning {
  kind: LaunchWarningKind;
  detail: string;
  /** For 'risky-flag': the exact flags flagged, so the card can mark them. */
  flags?: string[];
}

export interface ValidatedLaunch {
  request: LaunchRequest;          // folder realpath'd
  agentCommand: string;            // resolved agent command
  args: string[];                  // flags + prompt args, spawn order
  command: string;                 // display string (Argus injection omitted)
  warnings: LaunchWarning[];
  folderAgentConfig: string[];     // sorted '<relpath>#<sha256-hex-16>' per agent config file found (+ bare '.claude/')
}

export type ValidationResult = { ok: true; value: ValidatedLaunch } | { ok: false; error: string };

export interface Launcher {
  id: string;
  label: string;
  request: LaunchRequest;
  agentCommand: string;
  folderConfigAtSave: string[];
  createdAt: string;
}

export type RunResolution =
  | { kind: 'unknown' }
  | { kind: 'invalid'; error: string }
  | { kind: 'live'; sessionId: string }
  | { kind: 'changed'; launcher: Launcher; validated: ValidatedLaunch }
  | { kind: 'ready'; launcher: Launcher; validated: ValidatedLaunch };

export type PendingLaunchState = 'pending' | 'starting' | 'error' | 'expired';

export interface PendingLaunchView {
  id: string;
  source: 'new' | 'run';
  launcherId?: string;
  label: string;
  agent: string;
  folder: string;
  args: string[];
  prompt?: string;
  command: string;
  engine?: TerminalEngine;
  mode?: RunMode;
  name?: string;
  worktree?: string;
  base?: string;
  warnings: LaunchWarning[];
  state: PendingLaunchState;
  error?: string;
  receivedAt: number;
  canSaveAsLauncher: boolean;
}

export interface SaveAsLauncher {
  id: string;
  label: string;
  overwrite?: boolean;
}

export type LaunchActionResult = { ok: true } | { ok: false; error: string };

export interface AgentDetectionResponse {
  agents: AgentStatus[];
}

export interface SessionInfo {
  id: string;
  name: string;
  folderPath: string;
  status: SessionStatus;
  createdAt: string;
  agentType: AgentType;
  flags: string[];  // flags this session was created with
  hasGitChanges?: boolean;
  worktreePath?: string;    // set for worktree sessions; equals folderPath
  worktreeBranch?: string;  // branch name this worktree is on
  lastPrompt?: string;      // extracted prompt text when status === 'waiting'; used by notifications
  /** Per-session terminal implementation preference. undefined = never chose;
   *  the renderer resolves the app default (see AppConfig.defaultTerminalEngine). */
  terminalEngine?: TerminalEngine;
  /** How the agent is hosted. Missing ⇒ 'persistent' (sessions created before run modes). */
  runMode?: RunMode;
  /** Deep-link launcher that started this session. */
  launcherId?: string;
  /** Plain Shell only: the directory the shell is in now (OSC 7), and its git state. */
  cwd?: string;
  shellGit?: ShellGitContext | null;
  /** Claude and Codex: token / context meter built from the agent's transcript (Claude) or rollout log (Codex). */
  usage?: SessionUsage;
  /** Claude only: the conversation id the agent last reported (what Resume reopens). */
  claudeSessionId?: string;
  /** Epoch ms the session entered `waiting`; set only while waiting. */
  waitingSince?: number;
  /** While waiting: the menu choices on screen, when they could be read reliably. */
  promptOptions?: PromptOption[];
  /** With promptOptions: the menu's question as shown on screen (lastPrompt may be a hook's generic text). */
  promptQuestion?: string;
  /** GitHub PR of the session's branch (via `gh`), when there is one. */
  pr?: SessionPr;
  /** Beta F8: days since the worktree branch's last commit, set only once it
   *  is stale (≥ 15 days) and only while `betaWorktreeLifecycle` is on. */
  worktreeStaleDays?: number;
}

// ── Beta F8: worktree lifecycle ────────────────────────────────────────────

/** One step of "Finish…" on a worktree shell, always run in this order. */
export type WorktreeFinishStep = 'commit' | 'push' | 'pr';

/** What the Finish sheet shows before anything runs. */
export interface WorktreeFinishInfo {
  worktreePath: string;
  branch: string;
  /** e.g. `origin/feat/x`; null when the branch was never pushed. */
  upstream: string | null;
  /** The repo's default branch — the PR base and the "fully merged" target. */
  defaultBranch: string;
  /** Uncommitted changes in the worktree (offer the Commit step). */
  dirty: boolean;
  /** The branch's PR, when `gh` knows one. */
  pr: SessionPr | null;
  /** `gh` is installed and logged in, so "Open PR" can create one. */
  ghAvailable: boolean;
  /** GitHub compare URL — the fallback when `gh` is unavailable. */
  compareUrl: string | null;
  /** The branch's PR is merged, or the branch is fully merged into the default branch. */
  merged: boolean;
  /** Removal is allowed: PR merged or branch fully merged, and a clean tree. */
  removable: boolean;
  /** Why removal is not offered (dirty tree / not merged). */
  removeBlockedReason?: string;
}

export interface WorktreeFinishRequest {
  steps: WorktreeFinishStep[];
  /** Commit message; required when `steps` includes `commit`. */
  message?: string;
}

export interface WorktreeFinishStepResult {
  step: WorktreeFinishStep;
  /** `skipped`: an earlier step failed, so this one never ran. */
  status: 'ok' | 'failed' | 'skipped';
  detail?: string;
  /** PR or compare URL produced by the `pr` step. */
  url?: string;
}

export interface WorktreeFinishResponse {
  ok: boolean;
  results: WorktreeFinishStepResult[];
}

// ── Beta F6: activity timeline ─────────────────────────────────────────────

/** What an activity entry records (one Claude hook event each). */
export type ActivityEventType = 'tool' | 'subagent' | 'compact' | 'prompt' | 'notification' | 'stop';

/**
 * One entry of a session's activity feed, built server-side from a capped hook
 * payload. `summary` is at most 200 characters and never carries file contents
 * or Write/Edit bodies — for file tools it is the path alone.
 */
export interface ActivityEvent {
  /** Per-server monotonically increasing id (stable React key, dedupe). */
  id: number;
  /** Epoch ms when the server received the hook. */
  at: number;
  type: ActivityEventType;
  /** Tool name, for `type: 'tool'`. */
  tool?: string;
  summary: string;
  /** Absolute path of the file a file tool touched (Read/Write/Edit/NotebookEdit). */
  filePath?: string;
}

/** `GET /api/sessions/:id/activity` — oldest first. */
export interface ActivityListResponse {
  events: ActivityEvent[];
}

/** Beta F12 — body of `POST /api/sessions/:id/handoff`. */
export interface HandoffRequest {
  /** Agent for the new shell (default: the source shell's agent). */
  agentType?: string;
  /** Folder for the new shell (default: the source shell's folder). */
  folderPath?: string;
  /** Last N user/assistant messages from a Claude source's transcript (0–50, default 10). */
  messageCount?: number;
  /** Include `git diff` (capped) on top of status and stat (default true). */
  includeDiff?: boolean;
  /** Free-text note, added to the brief and to the first prompt. */
  note?: string;
  /** Build the brief and report its size without creating anything. */
  preview?: boolean;
}

/** What the brief would contain (`preview: true`), and what was written otherwise. */
export interface HandoffBriefStats {
  bytes: number;
  messages: number;
  isGitRepo: boolean;
  diffTruncated: boolean;
}

export interface HandoffPreviewResponse extends HandoffBriefStats {
  preview: true;
}

export interface HandoffResponse extends HandoffBriefStats {
  preview: false;
  session: SessionInfo;
  briefPath: string;
}

// ── Beta F10: multi-session templates ──────────────────────────────────────
// Server copies live in server/src/constants/templates.ts (check-dep-sync pins them).
/** Most session specs one template may hold. */
export const TEMPLATE_MAX_SPECS = 8;
/** Longest initial prompt a spec may carry, in characters. */
export const TEMPLATE_PROMPT_MAX = 4000;
/** Longest template name, in characters. */
export const TEMPLATE_NAME_MAX = 60;

/** One shell a template starts. */
export interface TemplateSpec {
  /** Agent id, checked against AgentRegistry. */
  agent: string;
  /** Absolute folder; stored realpath'd. */
  folder: string;
  /** Create a new worktree on this new branch (from HEAD) and start there. */
  worktreeBranch?: string;
  /** First prompt, passed on the agent's command line (quoted). */
  prompt?: string;
  /** Session name; defaults to the folder's basename. */
  name?: string;
}

/** A saved template (server/data/templates.json — never config.json). */
export interface SessionTemplate {
  id: string;
  name: string;
  specs: TemplateSpec[];
  createdAt: string;
  updatedAt: string;
}

/** Body of POST /api/templates and PUT /api/templates/:id. */
export interface SaveTemplateRequest {
  name: string;
  specs: TemplateSpec[];
}

/** 400 body of a save or a launch whose specs failed validation. */
export interface TemplateErrorResponse {
  error: string;
  /** Per-spec errors, by index into `specs`. */
  specErrors?: Array<{ index: number; error: string }>;
}

export interface TemplateListResponse {
  templates: SessionTemplate[];
}

/** Body of POST /api/templates/:id/launch. */
export interface LaunchTemplateRequest {
  /** The window the new shells belong to (defaults to main). */
  windowId?: string;
}

/** What happened to one spec of a launch. Best effort: no rollback. */
export type TemplateSpecResult =
  | { index: number; ok: true; session: SessionInfo }
  | { index: number; ok: false; error: string };

export interface LaunchTemplateResponse {
  /** The new group holding every started shell; null when none started. */
  group: SessionGroup | null;
  results: TemplateSpecResult[];
}

// ── Beta F13: session chains ───────────────────────────────────────────────
// Server copies live in server/src/constants/chains.ts (check-dep-sync pins them).
/** Longest prompt a chain may send, in characters. */
export const CHAIN_PROMPT_MAX = 4000;
/** A chain that fires this many times within an hour disarms itself. */
export const CHAIN_MAX_FIRES_PER_HOUR = 10;
/** All chains together fire at most this many times per hour; extra fires are dropped. */
export const CHAIN_GLOBAL_MAX_FIRES_PER_HOUR = 30;

/** The source status that fires a chain, on the edge into it. */
export type ChainTrigger = 'idle' | 'waiting' | 'done';
/** `once` disarms after the first fire; `repeat` stays armed. */
export type ChainMode = 'once' | 'repeat';

/** "When session A enters `trigger`, send `prompt` to session B" (server/data/chains.json). */
export interface SessionChain {
  id: string;
  sourceId: string;
  targetId: string;
  trigger: ChainTrigger;
  mode: ChainMode;
  prompt: string;
  armed: boolean;
  /** Why the chain is disarmed (auto-disarm after a once fire, or the rate cap). */
  disarmedReason?: string;
  createdAt: string;
  lastFiredAt?: string;
  fireCount: number;
}

/** Body of POST /api/chains. */
export interface CreateChainRequest {
  sourceId: string;
  targetId: string;
  trigger: ChainTrigger;
  mode?: ChainMode;
  prompt: string;
}

/** Body of PATCH /api/chains/:id. */
export interface ArmChainRequest {
  armed: boolean;
}

export type ChainFireOutcome = 'sent' | 'queued' | 'dropped';

/** One entry of the in-memory fire audit (last 50, newest first). */
export interface ChainFire {
  at: string;
  chainId: string;
  sourceId: string;
  targetId: string;
  sourceName?: string;
  targetName?: string;
  outcome: ChainFireOutcome;
  reason?: string;
}

export interface ChainListResponse {
  chains: SessionChain[];
}

export interface ChainAuditResponse {
  fires: ChainFire[];
}

/** Lifecycle of a pull request; `draft` is an open PR marked as draft. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed';
/** Aggregate of a PR's checks. `none` = the PR has no checks at all. */
export type PrCiStatus = 'pending' | 'success' | 'failure' | 'none';

/** `gh pr view` reviewDecision; `none` = no review required or requested. */
export type PrReviewDecision = 'approved' | 'changes_requested' | 'review_required' | 'none';
/** Whether GitHub can merge the PR cleanly; `unknown` while it is computing. */
export type PrMergeable = 'mergeable' | 'conflicting' | 'unknown';

/** The pull request a session's branch belongs to (from `gh pr view`). */
export interface SessionPr {
  number: number;
  state: PrState;
  url: string;
  ci: PrCiStatus;
  /** Head branch of the PR. */
  branch: string;
  /** Present when gh reported them (B3: the Inspector's PR list). */
  title?: string;
  review?: PrReviewDecision;
  mergeable?: PrMergeable;
  /** C1: per-outcome breakdown of the checks; absent when the PR has none. */
  checks?: PrChecks;
  /** C1: SHA of the PR's head commit (`headRefOid`), so a checks outcome is
   *  told apart from the previous push's. */
  headSha?: string;
  /** C2: lines added / deleted over the whole PR; both or neither. */
  additions?: number;
  deletions?: number;
}

/** C1: how many of a PR's checks passed, failed, are still running, or were skipped. */
export interface PrCheckCounts {
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
}

/** C1: one failed check; `url` is its details page when GitHub has one. */
export interface PrFailedCheck {
  name: string;
  url?: string;
}

/** C1: the checks of a PR beyond the `ci` aggregate — the CI monitoring popover. */
export interface PrChecks {
  counts: PrCheckCounts;
  /** Bounded list (see the server's PR_FAILED_CHECKS_MAX). */
  failed: PrFailedCheck[];
}

/** One PR of a session in the Inspector's GitHub card (B3). */
export interface SessionPrEntry {
  /** github.com PR URL — the row's identity. */
  url: string;
  /** Live status; null when gh couldn't read it (offline, no access). */
  pr: SessionPr | null;
  /** The PR of the branch checked out in the session folder. */
  folderBranch: boolean;
  /** The session's conversation created or pushed to it (a `pr-link` entry). */
  linked: boolean;
}

/** GET /api/sessions/:id/prs — newest first. `enabled` false when PR status
 *  is switched off in Settings (then `prs` is empty). */
export interface SessionPrsResponse {
  enabled: boolean;
  prs: SessionPrEntry[];
}

/** GET /api/sessions/:id/pr-diff?url=… (B4) — one PR's changes (`gh pr diff`).
 *  The URL must be one of the session's PRs (see SessionPrsResponse). */
export interface SessionPrDiffResponse {
  /** The PR, as the session's list spells it. */
  url: string;
  /** Raw unified diff of every changed file; empty when `truncated`. */
  diff: string;
  /** The diff exceeded `limitBytes`: only the changed paths are listed —
   *  every one when `complete`, else a partial list (possibly empty). */
  truncated?: { files: string[]; complete: boolean; limitBytes: number };
}

/** POST /api/sessions/:id/prs/ready (C3) — `gh pr ready` (or `--undo` when
 *  `ready` is false) on one of the session's PRs (see SessionPrsResponse). */
export interface SessionPrReadyRequest {
  url: string;
  ready: boolean;
}

/** The PR read again after the change; null when gh couldn't read it. */
export interface SessionPrReadyResponse {
  pr: SessionPr | null;
}

/** One choice of a waiting agent's selection menu, answered through
 *  `session:answer` with its `key` ("1"–"9"; a `freeText` option also needs `text`). */
export interface PromptOption {
  key: string;
  label: string;
  /** multiSelect question: whether the option is ticked (its key toggles it). */
  checked?: boolean;
  /** Free-text choice ("Type something."): answered with `key` plus the typed `text`. */
  freeText?: boolean;
}

/**
 * Token usage of a Claude session, summed from the `message.usage` blocks of
 * its transcript(s). Cumulative across /clear and restarts of the same Argus
 * session; the context fields describe the latest main-thread turn only.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Sum of the four counters above. */
  totalTokens: number;
  /** Model of the latest main-thread turn (as written in the transcript). */
  model?: string;
  /** Prompt size of the latest main-thread turn: input + cache read + cache write. */
  contextTokens?: number;
  /** Window of `model`, when known. */
  contextWindow?: number;
  /** contextTokens / contextWindow × 100, when the window is known. */
  contextPct?: number;
  /** Epoch ms of the last change. */
  updatedAt: number;
}

/**
 * One content block of a chat message (B1 Chat view). Parsed tolerantly from
 * the Claude Code transcript, which is not a public API: anything the parser
 * does not recognise becomes `unknown` instead of breaking the view.
 */
export type ChatBlock =
  | { kind: 'text'; text: string }
  /** A tool call; only the tool name is shown in phase 1. */
  | { kind: 'tool'; name: string }
  /** An attached image; `path` when the prompt names a file a session can read (for a thumbnail). */
  | { kind: 'image'; path?: string }
  /** A slash command as typed (`/model` + `opus`), or a `!` bash command (name `!`). */
  | { kind: 'command'; name: string; args?: string }
  /** What a local command (or `!` bash command) printed; shown collapsed. */
  | { kind: 'output'; text: string; stream: 'stdout' | 'stderr' }
  /** A one-line notice from Claude Code itself ("Unknown command: /foo", …). */
  | { kind: 'notice'; text: string }
  | { kind: 'unknown'; type: string };

/** A skill or custom slash command Claude Code offers, for the composer's `/` autocomplete. */
export interface ChatCommand {
  /** Without the slash: `pr-review`, `plugin:skill`. */
  name: string;
  description?: string;
}

/** One earlier Claude conversation of a session's folder (the Chat view's /resume picker). */
export interface ClaudeConversation {
  /** Claude Code's conversation id (`/resume <id>`). */
  id: string;
  /** Custom title, else the last or first prompt. */
  title: string;
  /** Epoch ms of the transcript's last write. */
  updatedAt: number;
  /** The conversation the session is in now. */
  current?: boolean;
}

export interface ClaudeConversationsResponse {
  conversations: ClaudeConversation[];
}

/** One transcript entry rendered by the Chat view. */
export interface ChatMessage {
  /** The entry's uuid (unique per JSONL line), or `echo-…` for a local echo. */
  id: string;
  /** `system`: local command output and Claude Code notices, not a turn of either side. */
  role: 'user' | 'assistant' | 'system';
  /** Epoch ms, when the entry carries a timestamp. */
  ts?: number;
  blocks: ChatBlock[];
  /**
   * A slash command sent from the Chat view that the transcript has not (yet)
   * recorded. Claude Code never writes some commands (`/cost`, `/context`,
   * `/help`, a dismissed picker…); the echo is replaced when it does.
   */
  echo?: boolean;
}

/**
 * Chat view update for one session. `reset` replaces the client's list (first
 * snapshot, or a different transcript after /clear or resume); otherwise the
 * messages are appended, deduped by id. `available` is false while the session
 * has no readable transcript yet, so the client can fall back to the shell.
 */
export interface ChatUpdate {
  sessionId: string;
  reset: boolean;
  available: boolean;
  messages: ChatMessage[];
  /**
   * Claude Code's permission mode as of the latest user entry (`default`,
   * `acceptEdits`, `plan`, `auto`, `bypassPermissions`, …), when known. Sent on
   * a reset and whenever it changes.
   */
  permissionMode?: string;
  /**
   * Display name of the model last set with `/model` in this conversation
   * (e.g. "Opus 5.5", from Claude Code's "Set model to …" output). Same
   * delivery as `permissionMode`.
   */
  modelSet?: string;
  /** Ids of earlier messages to drop (a local echo the transcript caught up with). */
  removed?: string[];
  /**
   * Skills and custom commands, from the transcript's skill listing (built-in
   * commands are the client's own list). Same delivery as `permissionMode`.
   */
  commands?: ChatCommand[];
}

/** Agent kinds whose plan (subscription) usage the meter shows. */
export type PlanUsageAgent = 'claude' | 'codex';

/** One plan usage window, as the agent reported it. */
export interface PlanWindow {
  /** 0..100. */
  usedPct: number;
  /** Epoch ms when the window resets, when known. */
  resetsAt?: number;
  /** Window length in minutes (300 = 5 hours, 10080 = 7 days), when known. */
  windowMinutes?: number;
  /** The reset time has passed: shown as 0% until a fresh reading arrives. */
  reset?: boolean;
}

/**
 * Plan usage of one agent account (all shells of that agent share it). Claude:
 * `primary` = 5-hour window, `secondary` = 7-day window (claude.ai plans only).
 * Codex: its `primary` / `secondary` rate-limit windows.
 */
export interface PlanUsage {
  primary?: PlanWindow;
  secondary?: PlanWindow;
  /** Epoch ms of the reading. */
  observedAt: number;
}

export type PlanUsageMap = Partial<Record<PlanUsageAgent, PlanUsage>>;

/** Git state of a plain Shell's current directory (follows `cd`). */
export interface ShellGitContext {
  /** Repo root (`git rev-parse --show-toplevel`) — Diff / Files follow it. */
  root: string;
  /** Branch name, or the short sha when HEAD is detached (null on an empty repo). */
  branch: string | null;
  detached: boolean;
  /** Commits not yet pushed / not yet pulled. null = no upstream configured. */
  ahead: number | null;
  behind: number | null;
  /** Changed + untracked files. */
  changes: number;
}

export interface CreateSessionRequest {
  folderPath: string;
  name?: string;
  agentType?: AgentType;
  flags?: string[];  // resolved flag value strings to append to command
  worktreeBranch?: string;  // if set, create a git worktree on this branch
  worktreeBase?: string;    // base branch/commit for the new branch (default: HEAD)
  terminalEngine?: TerminalEngine;
  runMode?: RunMode;
}

export interface CreateSessionResponse extends SessionInfo {}

/** PATCH /api/sessions/:id/restart. `resume` reopens the Claude conversation
 *  (`claude --resume <claudeSessionId>`) instead of starting fresh. */
export interface RestartSessionRequest {
  resume?: boolean;
}

/** Display-name change for a live shell. The tmux session name derives from the
 *  session id, so a rename is purely cosmetic and never touches the backend pty. */
export interface RenameSessionRequest {
  name: string;
}

/** Longest accepted shell display name. Long enough for a descriptive label,
 *  short enough that the tile header still fits its status pill. */
export const SESSION_NAME_MAX = 60;

/** Session Inspector column width bounds (px); the server clamps `inspectorWidth` to them. */
export const INSPECTOR_WIDTH_MIN = 220;
export const INSPECTOR_WIDTH_MAX = 560;

export const FAVORITES_GROUP_ID = '__favorites__';

export interface FavoriteEntryMeta {
  folderPath: string;
  name: string;
  agentType: AgentType;
  flags: string[];
}

export interface SessionGroup {
  id: string;            // crypto.randomUUID()
  name: string;
  color: string;         // groupColors palette key
  collapsed: boolean;
  sessionIds: string[];  // membership + within-group display order
  entryMeta?: Record<string, FavoriteEntryMeta>;  // Favourites group only: metadata for resurrection
}

export interface GetGroupsResponse {
  groups: SessionGroup[];
}

export interface SaveGroupsRequest {
  groups: SessionGroup[];
}

// ---- Multi-window ----

/** Fixed id of the primary window. Sessions with no assignment belong here. */
export const MAIN_WINDOW_ID = 'main';

export interface ArgusWindow {
  /** 'main' for the primary window, crypto.randomUUID() otherwise. */
  id: string;
  /** 'Main', 'Window 2', … */
  label: string;
  isMain: boolean;
  createdAt: number;
}

/** Full window registry snapshot — windows plus sessionId → windowId assignments.
 *  A session absent from `assignments` belongs to the main window. */
export interface WindowRegistryState {
  windows: ArgusWindow[];
  assignments: Record<string, string>;
}

export interface PathCompletionResponse {
  completions: string[];
}

/** Longest text one broadcast may carry, and most sessions it may target.
 *  Duplicated in server/src/constants/broadcast.ts (kept in sync by check:deps). */
export const BROADCAST_MAX_TEXT = 4000;
export const BROADCAST_MAX_TARGETS = 50;

/** Send `text` (then Enter, when `enter`) to every session in `sessionIds`.
 *  Single-line: control characters (newlines included) are refused. */
export interface BroadcastRequest {
  sessionIds: string[];
  text: string;
  enter?: boolean;
}

export type BroadcastResult =
  | { ok: true; sent: number; skipped: number }
  | { ok: false; error: string };

// Socket.io typed events
export interface ClientToServerEvents {
  'session:join': (sessionId: string) => void;
  /**
   * "My screen has drifted — realign it, but leave my scrollback alone." Asked by
   * a client that is already in the room and already holds correct history (after
   * a refit, or once output settles). Answered with a screen-only frame; a join
   * would answer with a history-bearing one that erases the reader's place.
   */
  'session:resync': (sessionId: string) => void;
  'session:leave': (sessionId: string) => void;
  'session:input': (payload: { sessionId: string; data: string }) => void;
  'session:resize': (payload: { sessionId: string; cols: number; rows: number }) => void;
  'session:clear-buffer': (sessionId: string) => void;
  'session:seen': (sessionId: string) => void;
  'session:mark-done': (sessionId: string) => void;
  /** Type the same text into several sessions at once (validated + rate-limited server-side). */
  'session:broadcast': (payload: BroadcastRequest, ack?: (result: BroadcastResult) => void) => void;
  /**
   * Answer a waiting menu; refused unless that option is on screen now. `key` is
   * an option's key, or 'next' to leave a multiSelect question (Tab); `text` is
   * required by a `freeText` option and typed for the user. The server picks the
   * keystrokes: the digit, or arrow keys + Enter for an unnumbered menu.
   */
  'session:answer': (payload: { sessionId: string; key: string; text?: string }, ack?: (result: { ok: true } | { ok: false; error: string }) => void) => void;
  // Companion terminals (one per session, persists while parent session is alive)
  /** `size` is the client's grid; a not-yet-running shell spawns at it (default 120x30). */
  /** Start receiving `session:chat` updates for a Claude session (B1 Chat view). */
  'session:chat:subscribe': (sessionId: string) => void;
  'session:chat:unsubscribe': (sessionId: string) => void;
  /**
   * Type a Chat view message (or slash command) into a subscribed Claude session
   * and submit it; the server re-presses Enter if the text stayed in the input box.
   */
  'session:chat:send': (payload: { sessionId: string; text: string }, ack?: (result: { ok: boolean }) => void) => void;
  /** Switch Claude Code's permission mode (Shift+Tab until the footer shows `mode`). */
  'session:chat:setMode': (payload: { sessionId: string; mode: string }, ack?: (result: { ok: boolean }) => void) => void;
  'ct:join': (sessionId: string, size?: { cols: number; rows: number }) => void;
  'ct:leave': (sessionId: string) => void;
  'ct:input': (payload: { sessionId: string; data: string }) => void;
  'ct:resize': (payload: { sessionId: string; cols: number; rows: number }) => void;
}

/**
 * Authoritative replay frame sent on (re)join. Distinct from streaming
 * `session:output` so the client can reconcile its buffer/mouse state to tmux's
 * truth BEFORE writing the frame — `alternate` forces xterm onto the matching
 * buffer, `appMouse`/`sgr` reset the wheel-forwarding gate. Steady-state output
 * keeps flowing over `session:output` and is never used for reconciliation.
 */
export interface SessionReplay {
  sessionId: string;
  data: string;
  alternate: boolean;
  appMouse: boolean;
  sgr: boolean;
  /**
   * Why this frame was sent. `join` (default) is the client asking — it must be
   * painted, or the terminal stays blank/garbled. `refresh` is the server pushing
   * an improved frame nobody asked for (e.g. after trimming stale scrollback); a
   * client whose user is scrolled up reading history may skip it, since the frame
   * resets the viewport to the bottom and one will be served again on the next join.
   * `resync` is a screen-only realignment (see 'session:resync'): it carries no
   * history and no ED 3, so it costs a scrolled-up reader nothing and is always
   * painted.
   */
  reason?: 'join' | 'refresh' | 'resync';
}

export interface SessionStatusPayload {
  sessionId: string;
  status: SessionStatus;
  lastPrompt?: string;
  /** See SessionInfo.waitingSince / promptOptions — present only while waiting. */
  waitingSince?: number;
  promptOptions?: PromptOption[];
  promptQuestion?: string;
}

export interface ServerToClientEvents {
  'session:output': (payload: { sessionId: string; data: string }) => void;
  'session:replay': (payload: SessionReplay) => void;
  'session:status': (payload: SessionStatusPayload) => void;
  'session:exit': (payload: { sessionId: string; exitCode: number }) => void;
  'session:created': (session: SessionInfo) => void;
  'session:deleted': (payload: { sessionId: string }) => void;
  'session:renamed': (payload: { sessionId: string; name: string }) => void;
  'ngrok:status': (status: NgrokStatus) => void;
  'keepawake:status': (status: KeepAwakeStatus) => void;
  /** Broadcast on every window-registry mutation (create/delete/assign/merge). */
  'window:state': (state: WindowRegistryState) => void;
  'auth:required': (payload: { required: boolean }) => void;
  'update:available': (status: UpdateStatus) => void;
  'update:applying': () => void;
  'update:progress': (progress: UpdateProgress) => void;
  'update:failed': (payload: { error: string; upToDate?: boolean }) => void;
  'session:error': (payload: { sessionId: string; message: string }) => void;
  'session:gitStatus': (payload: { sessionId: string; hasGitChanges: boolean }) => void;
  'session:shellContext': (payload: { sessionId: string; cwd: string; shellGit: ShellGitContext | null }) => void;
  /** The session's PR / CI state changed; null = no PR (or the feature is off). */
  'session:pr': (payload: { sessionId: string; pr: SessionPr | null }) => void;
  /** Beta F8: the worktree's stale marker changed; null = not stale (or the feature is off). */
  'session:worktreeStale': (payload: { sessionId: string; staleDays: number | null }) => void;
  /** Beta F6: one new activity entry, emitted only to the session's room. */
  'session:activity': (payload: { sessionId: string; event: ActivityEvent }) => void;
  /** A Claude or Codex session's usage meter changed (throttled to at most ~1/s per session). */
  'session:usage': (payload: { sessionId: string; usage: SessionUsage }) => void;
  /** Chat view messages for a subscribed Claude session (see ChatUpdate). */
  'session:chat': (payload: ChatUpdate) => void;
  /** The permission mode Claude Code shows on screen changed (Chat view subscribers only). */
  'session:chatMode': (payload: { sessionId: string; permissionMode: string }) => void;
  /** An agent account's plan usage changed (shared by every shell of that agent). */
  'usage:plan': (payload: { agent: PlanUsageAgent; plan: PlanUsage }) => void;
  /** A Claude session reported a (new) conversation id — Resume reopens it. */
  'session:claudeId': (payload: { sessionId: string; claudeSessionId: string }) => void;
  /** Filesystem change detected under a session's folder. `dirs` are the
   *  absolute parent directories of changed entries (tree path scheme), so the
   *  client can re-fetch just those folders. */
  'session:fsChanged': (payload: { sessionId: string; dirs: string[] }) => void;
  /** groups.json was rewritten server-side (beta F10 template launch); refetch. */
  'groups:changed': () => void;
  /** Beta F13: a chain was created, removed, armed, disarmed or fired; refetch. */
  'chains:changed': () => void;
  // Companion terminal responses
  'ct:output': (payload: { sessionId: string; data: string }) => void;
  'ct:exit': (payload: { sessionId: string; exitCode: number }) => void;
}

/**
 * Live progress of an in-app brew self-update. Streamed main → server → renderer
 * over the `update:progress` socket event while the app stays open (Phase 1:
 * trust → update → download). `percent` is present only when brew emits parseable
 * download progress; otherwise the bar renders stepped/indeterminate per phase.
 */
export interface UpdateProgress {
  phase: 'trust' | 'update' | 'download' | 'install';
  label: string;
  percent?: number;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  changelog: string;
  releaseUrl: string;
}

export interface UpdateApplyResponse {
  success: boolean;
  error?: string;
  warning?: string;
  requiresConfirmation?: boolean;
}

export type NgrokTunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface NgrokStatus {
  installed: boolean;
  tunnelStatus: NgrokTunnelStatus;
  publicUrl: string | null;
  error: string | null;
  platform: string;
  authRequired: boolean;
}

/**
 * State of the manual "keep this Mac awake" window (the toolbar CTA).
 *
 * Server-owned: the client renders a countdown from `expiresAt` but never
 * decides when the window ends. Not persisted — an armed window dies with the app.
 */
export interface KeepAwakeStatus {
  active: boolean;
  /** Epoch ms when the window ends. null when off, and null when indefinite. */
  expiresAt: number | null;
  indefinite: boolean;
}

export interface NgrokStartResponse {
  publicUrl: string;
  token: string;
}

export interface AuthStatus {
  required: boolean;
  authenticated?: boolean;
}

export interface AuthLoginResponse {
  token: string;
}

export interface GitDiffResponse {
  unstaged: string;
  staged: string;
  branch: string;
  untracked: string[];
  /** All-added diff (`git diff --no-index`) for the untracked files, so they preview like tracked changes. */
  untrackedDiff: string;
  /** Files left out because their diff alone would overflow the response
   *  (e.g. a staged deletion of a huge JSON). Listed as header-only entries. */
  oversized?: string[];
  error?: string;
}

export interface DiffFileRequest {
  filePath: string;
  contextLines: number;
  source: 'unstaged' | 'staged' | 'branch';
}

export interface DiffFileResponse {
  diff: string;
  error?: string;
}

// Selective commit types

export interface ChunkSelection {
  chunkIndex: number;
  selectedChangeIndices: number[]; // 0-based indices into add/del changes only
}

export interface PatchSelectionRequest {
  filePath: string;     // file.to ?? file.from from parse-diff output
  fromPath?: string;    // for renames: file.from
  source: 'unstaged' | 'staged';
  chunks: ChunkSelection[];
}

export interface PatchOperationResponse {
  success: boolean;
  error?: string;    // raw git stderr on failure
  undoId?: string;   // UUID for the discard undo buffer (discard ops only)
}

export interface CommitRequest {
  message: string;
  amend: boolean;
  files?: string[]; // when provided, commit only staged changes for these files (git commit -- <files>)
}

export interface CommitResponse {
  success: boolean;
  error?: string;
  commitHash?: string; // short SHA on success
}

export interface GitLogResponse {
  lastMessage: string;
  isFirstCommit: boolean;
}

export interface MergePreviewFile {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
  isNew: boolean;
  isDeleted: boolean;
}

export interface WorktreeMergePreviewResponse {
  files: MergePreviewFile[];
  totalAdditions: number;
  totalDeletions: number;
  sourceBranch: string;
  targetBranch: string;
}

export interface GitBranchesResponse {
  branches: string[];
  currentBranch: string;
  behindCount?: number;
}

export interface GitCheckoutRequest {
  branch: string;
}

export interface GitCreateBranchRequest {
  name: string;
  from?: string;
}

export interface GitPullAndBranchRequest {
  branchName: string;
  baseBranch?: string;
}

export interface GitPullAndBranchResponse {
  success: boolean;
  error?: string;
  baseBranch?: string;
  newBranch?: string;
}

// Git file status types (for Explorer tree indicators)

/** One changed file in a session's git summary (Session Inspector). */
export interface GitSummaryFile {
  /** Repo-relative path (the new path of a rename). */
  path: string;
  /** M modified, A added, D deleted, R renamed, C copied, U conflicted, ? untracked. */
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';
  /** Has a staged change (the index side of `git status`). */
  staged: boolean;
}

/** Branch, upstream, ahead/behind and changed files of a session's work root. */
export interface GitSummary extends ShellGitContext {
  /** e.g. `origin/feat/x`; null when the branch tracks nothing. */
  upstream: string | null;
  /** At most GIT_SUMMARY_MAX_FILES entries; `changes` is the full count. */
  files: GitSummaryFile[];
}

/** GET /api/sessions/:id/git-summary — summary is null outside a git repo. */
export interface GitSummaryResponse {
  summary: GitSummary | null;
}

export type GitFileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | '?' | '!!';

export interface GitFileStatusResponse {
  statuses: Record<string, GitFileStatusCode>;
  gitRoot: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  hasChildren: boolean;
  isFile: boolean;
  ext: string;
  size?: number;
}

export interface DirectoryChildrenResponse {
  entries: DirectoryEntry[];
  parentPath: string;
}

export interface FileContentResponse {
  content: string;
  encoding: 'utf8' | 'base64';
  mimeType: string;
  size: number;
  truncated: boolean;
  mtimeMs: number;
}

export interface WriteFileRequest {
  sessionId: string;
  path: string;
  content: string;
  originalMtimeMs?: number;
}

export interface WriteFileResponse {
  success: boolean;
  size: number;
  mtimeMs: number;
  error?: string;
  conflict?: boolean;
}

export interface FileSearchResult {
  path: string;
  name: string;
  ext: string;
  matchType: 'filename' | 'content';
  lineNumber?: number;
}

export interface FileSearchResponse {
  results: FileSearchResult[];
  query: string;
}

// Find in Files (⌘⇧F in the explorer): ripgrep content search with options.

export interface FindInFilesMatch {
  /** 1-based line, matching Monaco. */
  line: number;
  /** 1-based column (UTF-16 units) of the first match on the line. */
  column: number;
  /** The matched line, trimmed and windowed around the first match. */
  preview: string;
  /** Highlight ranges inside `preview`, as [start, end) UTF-16 offsets. */
  ranges: [number, number][];
}

export interface FindInFilesFile {
  path: string;
  matches: FindInFilesMatch[];
}

export interface FindInFilesResponse {
  query: string;
  files: FindInFilesFile[];
  /** Matching lines returned (sum of every file's matches). */
  totalMatches: number;
  /** True when a result cap or the timeout cut the search short. */
  truncated: boolean;
}

// Symbol navigation (heuristic go-to-definition / find-usages). Text-based, no
// LSP — same-named symbols may collide; the client surfaces multiple candidates.

export type SymbolKind = 'function' | 'class' | 'type' | 'variable' | 'method' | 'unknown';

export interface SymbolLocation {
  path: string;
  /** 1-based line, matching Monaco. */
  line: number;
  /** 1-based column of the symbol on that line, matching Monaco. */
  column: number;
  /** Trimmed source line for preview. */
  preview: string;
  kind?: SymbolKind;
  /** 'strong' = matched a definition heuristic; 'weak' = reference-derived fallback. */
  confidence?: 'strong' | 'weak';
}

export interface DefinitionResponse {
  symbol: string;
  locations: SymbolLocation[];
  truncated: boolean;
}

export interface ReferencesResponse {
  symbol: string;
  locations: SymbolLocation[];
  truncated: boolean;
}

export interface ResolveImportResponse {
  /** Absolute path of the resolved file, or null if the specifier didn't resolve to a file. */
  path: string | null;
}

// Structured diff types (server-parsed --word-diff=porcelain output)

export interface DiffToken {
  type: 'context' | 'del' | 'add';
  text: string;
}

export interface DiffLine {
  type: 'context' | 'del' | 'add' | 'spacer';
  lineNo: number | null; // null for spacer rows
  tokens: DiffToken[];
}

export interface SideBySideLine {
  left: DiffLine;
  right: DiffLine;
}

export interface StructuredHunk {
  header: string; // @@ -x,y +x,y @@ context
  oldStart: number;
  newStart: number;
  lines: SideBySideLine[];
}

export interface StructuredDiffResponse {
  hunks: StructuredHunk[];
  isBinary: boolean;
  error?: string;
}

// Blame types

export interface BlameLineEntry {
  lineNo: number;
  hash: string;
  author: string;
  date: string; // ISO date string
  summary: string;
}

export interface BlameResponse {
  lines: BlameLineEntry[];
  error?: string;
}

// Changelist types

export interface ChangelistEntry {
  id: string;
  name: string;
  isDefault: boolean;
  fileKeys: string[]; // repo-relative file paths
}

export interface ChangelistStateResponse {
  version: number;
  activeId: string;
  lists: ChangelistEntry[];
}

// Commit selection (IntelliJ-style per-change-block checkboxes for the diff overlay)

export interface CommitSelectionBlock {
  hash: string; // sha256(filePath + "\n" + joined plain-text lines)
}

export interface CommitSelectionFile {
  filePath: string;
  source: 'unstaged';
  fromPath?: string;
  blocks: CommitSelectionBlock[];
}

export interface CommitSelectionState {
  version: 1;
  files: CommitSelectionFile[];
}

// File CRUD request/response types

export interface FileCrudResponse {
  success: boolean;
  error?: string;
}

export interface CreateFileRequest {
  sessionId: string;
  path: string; // absolute path
  isDir: boolean;
}

export interface RenameFileRequest {
  sessionId: string;
  fromPath: string; // absolute path
  toPath: string;   // absolute path
}

export interface DeleteFileRequest {
  sessionId: string;
  path: string; // absolute path
}

export interface MoveFileRequest {
  sessionId: string;
  fromPath: string;
  toPath: string;
}

// --- Agent janitor (F16) ---

/** A daemon (argusd on this data dir, or this app's tmux server) that is not the active backend. */
export interface OrphanDaemon {
  kind: 'argusd' | 'tmux';
  /** Socket label: argusd-<label>.sock, or tmux -L <label>. */
  label: string;
  pid: number;
  alive: boolean;
  /** Session ids its agents were spawned for (read from their --settings path), when visible. */
  sessionIds: string[];
  childPids: number[];
  /** RSS of the daemon and every descendant, in KB. */
  treeRssKb: number;
}

/** An agent process (claude / gemini / codex) running under an orphan daemon. */
export interface OrphanAgent {
  pid: number;
  agent: string;
  command: string;
  cwd: string | null;
  rssKb: number;
  /** Pid of the orphan daemon it runs under. */
  daemonPid: number;
  sessionId: string | null;
}

export interface OrphanReport {
  daemons: OrphanDaemon[];
  agents: OrphanAgent[];
  /** Sum of every orphan daemon's tree RSS, in KB. */
  totalRssKb: number;
  /** True only on the first startup check of this server process (drives the one-time toast). */
  notify?: boolean;
}

export interface OrphanKillResponse {
  /** Requested pids that were in the fresh orphan set. */
  accepted: number[];
  /** Requested pids that were not (never signalled). */
  rejected: number[];
  /** Every pid that got SIGTERM (requested pids plus their descendants). */
  signalled: number[];
  /** Pids still alive after the grace period, which got SIGKILL. */
  forceKilled: number[];
}

// ── Cross-session search (F9) ──────────────────────────────────────────────

/** One match: a terminal line or a transcript message, with a short snippet. */
export interface SearchHit {
  source: 'scrollback' | 'transcript';
  /** Plain text around the match (whitespace collapsed, at most ~160 chars). */
  snippet: string;
  /** Offset and length of the match inside `snippet`. */
  matchStart: number;
  matchLength: number;
  /**
   * Scrollback hits from a live mirror only: the buffer row the matching line
   * starts on. Absent for a hibernated or exited session, which is searched
   * from its stored frame, where row indices are not known.
   */
  line?: number;
  /** Transcript hits: who wrote the message. */
  role?: 'user' | 'assistant';
}

export interface SessionSearchResult {
  sessionId: string;
  sessionName: string;
  agentType: AgentType;
  /** How the scrollback was read: the live emulator, a stored frame (sleeping
   *  or exited session, not woken for the search), or not at all. */
  scrollback: 'live' | 'frozen' | 'none';
  hits: SearchHit[];
}

/** GET /api/search?q=&limit= */
export interface SearchResponse {
  query: string;
  results: SessionSearchResult[];
  /** The result cap or a time budget cut the search short. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// F5 auto-approval rules (PreToolUse hook decision)
// ---------------------------------------------------------------------------

/** Tools a rule may name, and how each one's input is matched. `command` tools
 *  match a command prefix, `file` tools a path glob inside the session folder.
 *  Duplicated in server/src/constants/autoApproval.ts (check:deps keeps them in sync). */
export const AUTO_APPROVAL_TOOLS = {
  Bash: 'command',
  Read: 'file',
  Edit: 'file',
  MultiEdit: 'file',
  Write: 'file',
  NotebookEdit: 'file',
} as const;

export type AutoApprovalTool = keyof typeof AUTO_APPROVAL_TOOLS;

/** One allow rule for a session folder. Rules can only ever produce "allow". */
export interface AutoApprovalRule {
  id: string;
  tool: AutoApprovalTool;
  /** Bash only (required): the command must equal this or start with it plus a space. */
  bashPrefix?: string;
  /** File tools only: glob relative to the session folder (`*`, `**`, `?`). Default `**`. */
  pathGlob?: string;
  createdAt: string;
}

export interface AutoApprovalAuditEntry {
  at: string;
  sessionId: string;
  tool: AutoApprovalTool;
  ruleId: string;
  /** Short, truncated summary of the tool input (the command or the relative path). */
  summary: string;
}

export interface AutoApprovalFolder {
  folder: string;
  ruleCount: number;
  /** True when a live (non-exited) session runs in this folder. */
  hasSession: boolean;
}

export interface AutoApprovalFolderState {
  folder: string;
  rules: AutoApprovalRule[];
  audit: AutoApprovalAuditEntry[];
}

export interface AddAutoApprovalRuleRequest {
  folder: string;
  tool: AutoApprovalTool;
  bashPrefix?: string;
  pathGlob?: string;
}
