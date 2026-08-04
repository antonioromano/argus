export type SessionStatus = 'waiting' | 'running' | 'idle' | 'done' | 'exited';

// How a waiting-for-input shell stands out in the mosaic grid.
export type MosaicWaitingStyle = 'breathing' | 'flag';

export type BuiltinAgentId = 'claude' | 'gemini' | 'codex';
export type AgentType = BuiltinAgentId | string;

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

export interface AppConfig {
  defaultAgent: AgentType;
  customAgents: AgentDefinition[];
  agentFlags: Record<string, AgentFlag[]>;  // keyed by agent ID
  notificationsEnabled: boolean;
  notifyOnWaiting: boolean;  // notify when a session needs user input
  notifyOnDone: boolean;     // notify when a session finishes a run
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
  debugToolsEnabled?: boolean; // reveal developer/debug CTAs (e.g. per-session diagnostics dump) (default: false)
  // When a shell's width changes, drop the scrollback that was wrapped for the old
  // width (default: FALSE). On buys a clean buffer; the price is that ordinary
  // navigation — a mosaic→focus switch is a width change — takes the session's
  // scroll history with it. Cmd+L clears on demand without that bargain.
  trimScrollbackOnResize?: boolean;
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
}

export interface AgentStatus {
  agent: AgentDefinition;
  installed: boolean;
  resolvedPath?: string;
}

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
}

export interface CreateSessionRequest {
  folderPath: string;
  name?: string;
  agentType?: AgentType;
  flags?: string[];  // resolved flag value strings to append to command
  worktreeBranch?: string;  // if set, create a git worktree on this branch
  worktreeBase?: string;    // base branch/commit for the new branch (default: HEAD)
}

export interface CreateSessionResponse extends SessionInfo {}

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

export interface PathCompletionResponse {
  completions: string[];
}

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
  // Ephemeral terminals (Explorer view only — not persisted, not in session list)
  'ephemeral:spawn': (payload: { id: string; cwd: string }) => void;
  'ephemeral:input': (payload: { id: string; data: string }) => void;
  'ephemeral:resize': (payload: { id: string; cols: number; rows: number }) => void;
  'ephemeral:kill': (payload: { id: string }) => void;
  // Companion terminals (one per session, persists while parent session is alive)
  'ct:join': (sessionId: string) => void;
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

export interface ServerToClientEvents {
  'session:output': (payload: { sessionId: string; data: string }) => void;
  'session:replay': (payload: SessionReplay) => void;
  'session:status': (payload: { sessionId: string; status: SessionStatus; lastPrompt?: string }) => void;
  'session:exit': (payload: { sessionId: string; exitCode: number }) => void;
  'session:created': (session: SessionInfo) => void;
  'session:deleted': (payload: { sessionId: string }) => void;
  'ngrok:status': (status: NgrokStatus) => void;
  'keepawake:status': (status: KeepAwakeStatus) => void;
  'auth:required': (payload: { required: boolean }) => void;
  'update:available': (status: UpdateStatus) => void;
  'update:applying': () => void;
  'update:progress': (progress: UpdateProgress) => void;
  'update:failed': (payload: { error: string; upToDate?: boolean }) => void;
  'session:error': (payload: { sessionId: string; message: string }) => void;
  'session:gitStatus': (payload: { sessionId: string; hasGitChanges: boolean }) => void;
  /** Filesystem change detected under a session's folder. `dirs` are the
   *  absolute parent directories of changed entries (tree path scheme), so the
   *  client can re-fetch just those folders. */
  'session:fsChanged': (payload: { sessionId: string; dirs: string[] }) => void;
  // Ephemeral terminal responses
  'ephemeral:output': (payload: { id: string; data: string }) => void;
  'ephemeral:exit': (payload: { id: string; exitCode: number }) => void;
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
