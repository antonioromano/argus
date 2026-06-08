export type SessionStatus = 'waiting' | 'running' | 'idle' | 'done' | 'exited';

export type BuiltinAgentId = 'claude' | 'gemini' | 'codex';
export type AgentType = BuiltinAgentId | string;

export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  builtin: boolean;
  installCommand?: string;
  installUrl?: string;
}

export interface AgentFlag {
  id: string;        // crypto.randomUUID()
  value: string;     // e.g. "--model opus-4", "--verbose"
  enabled: boolean;  // sticky default (last-used state per agent)
}

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
  'session:leave': (sessionId: string) => void;
  'session:input': (payload: { sessionId: string; data: string }) => void;
  'session:resize': (payload: { sessionId: string; cols: number; rows: number }) => void;
  'session:clear-buffer': (sessionId: string) => void;
  'session:seen': (sessionId: string) => void;
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

export interface ServerToClientEvents {
  'session:output': (payload: { sessionId: string; data: string }) => void;
  'session:status': (payload: { sessionId: string; status: SessionStatus; lastPrompt?: string }) => void;
  'session:exit': (payload: { sessionId: string; exitCode: number }) => void;
  'session:created': (session: SessionInfo) => void;
  'session:deleted': (payload: { sessionId: string }) => void;
  'ngrok:status': (status: NgrokStatus) => void;
  'auth:required': (payload: { required: boolean }) => void;
  'update:available': (status: UpdateStatus) => void;
  'update:applying': () => void;
  'session:error': (payload: { sessionId: string; message: string }) => void;
  'session:gitStatus': (payload: { sessionId: string; hasGitChanges: boolean }) => void;
  // Ephemeral terminal responses
  'ephemeral:output': (payload: { id: string; data: string }) => void;
  'ephemeral:exit': (payload: { id: string; exitCode: number }) => void;
  // Companion terminal responses
  'ct:output': (payload: { sessionId: string; data: string }) => void;
  'ct:exit': (payload: { sessionId: string; exitCode: number }) => void;
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
