import type { SessionInfo, CreateSessionRequest, RestartSessionRequest, PathCompletionResponse, DirectoryChildrenResponse, FileContentResponse, FileSearchResponse, GitDiffResponse, GitFileStatusResponse, NgrokStatus, NgrokStartResponse, AppConfig, AgentDetectionResponse, AuthStatus, AuthLoginResponse, UpdateStatus, UpdateApplyResponse, PatchSelectionRequest, PatchOperationResponse, CommitRequest, CommitResponse, GitLogResponse, WriteFileRequest, WriteFileResponse, GitBranchesResponse, DiffFileResponse, GitPullAndBranchResponse, StructuredDiffResponse, BlameResponse, ChangelistStateResponse, CommitSelectionState, FileCrudResponse, SessionGroup, WorktreeMergePreviewResponse, DefinitionResponse, ReferencesResponse, ResolveImportResponse, KeepAwakeStatus, ArgusWindow, WindowRegistryState, OrphanReport, OrphanKillResponse, SearchResponse, AutoApprovalFolder, AutoApprovalFolderState, AutoApprovalRule, AddAutoApprovalRuleRequest, WorktreeFinishInfo, WorktreeFinishResponse, WorktreeFinishStep, HandoffRequest, HandoffPreviewResponse, HandoffResponse } from '@argus/shared';

const API_BASE = '/api';
const TOKEN_KEY = 'orchestrator_auth_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string };
    return body.error || res.statusText || `HTTP ${res.status}`;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

async function requireOk(res: Response): Promise<Response> {
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return res;
}

export async function authFetch(
  url: string,
  init?: RequestInit,
  // When `intercept401` is false, a 401 is passed through to the caller instead
  // of being treated as a session-expiry (clear token + dispatch
  // `auth:unauthorized` + throw). The login endpoint needs this: it returns 401
  // on a wrong password, which must surface as an `ApiError('Incorrect
  // password')` via requireOk — not silently reset auth state.
  opts?: { intercept401?: boolean }
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Bypass ngrok's free-tier browser-warning interstitial, which otherwise
  // returns an HTML page instead of our JSON for XHR/fetch requests (any value
  // works). Harmless when not tunnelling. Without it, folder browsing over a
  // tunnel fails because the response can't be parsed as JSON.
  headers.set('ngrok-skip-browser-warning', 'true');
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && opts?.intercept401 !== false) {
    setToken(null);
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Authentication required');
  }
  return res;
}

export const api = {
  getSessions: async (): Promise<SessionInfo[]> => {
    const res = await authFetch(`${API_BASE}/sessions`);
    return (await requireOk(res)).json();
  },

  createSession: async (data: CreateSessionRequest): Promise<SessionInfo> => {
    const res = await authFetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return (await requireOk(res)).json();
  },

  deleteSession: async (id: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' }));
  },

  checkWorktree: async (params: {
    repoPath: string;
    branch?: string;
    worktreePath?: string;
    worktreeBranch?: string;
  }): Promise<{
    isGitRepo: boolean;
    branchExists?: boolean;
    headCommit?: string | null;
    isDirty?: boolean;
    isUnmerged?: boolean;
  }> => {
    const q = new URLSearchParams({ repoPath: params.repoPath });
    if (params.branch) q.set('branch', params.branch);
    if (params.worktreePath) q.set('worktreePath', params.worktreePath);
    if (params.worktreeBranch) q.set('worktreeBranch', params.worktreeBranch);
    const res = await authFetch(`${API_BASE}/worktrees/check?${q}`);
    return (await requireOk(res)).json();
  },

  listBranchesForRepo: async (repoPath: string): Promise<{ branches: string[]; currentBranch: string; behindCount?: number }> => {
    const q = new URLSearchParams({ repoPath });
    const res = await authFetch(`${API_BASE}/worktrees/branches?${q}`);
    return (await requireOk(res)).json();
  },

  deleteWorktree: async (worktreePath: string, repoPath: string, force = false): Promise<void> => {
    const res = await authFetch(`${API_BASE}/worktrees`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreePath, repoPath, force }),
    });
    await requireOk(res);
  },

  renameSession: async (id: string, name: string): Promise<SessionInfo> => {
    const res = await authFetch(`${API_BASE}/sessions/${id}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return (await requireOk(res)).json();
  },

  /** Relaunch the agent: fresh by default, or `{ resume: true }` to reopen the
   *  last Claude conversation (`claude --resume <id>`). */
  restartSession: async (id: string, opts: RestartSessionRequest = {}): Promise<SessionInfo> => {
    const res = await authFetch(`${API_BASE}/sessions/${id}/restart`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    return (await requireOk(res)).json();
  },

  dumpSessionDiagnostics: async (id: string): Promise<{ path: string }> => {
    const res = await authFetch(`${API_BASE}/sessions/${id}/diagnostics`, { method: 'POST' });
    return (await requireOk(res)).json();
  },

  forceDetectState: async (id: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/${id}/redetect`, { method: 'POST' }));
  },

  getPathCompletions: async (path: string): Promise<string[]> => {
    const res = await authFetch(`${API_BASE}/fs/autocomplete?path=${encodeURIComponent(path)}`);
    const data: PathCompletionResponse = await (await requireOk(res)).json();
    return data.completions;
  },

  openPath: async (sessionId: string, filePath: string, reveal = false): Promise<void> => {
    const res = await authFetch(`${API_BASE}/fs/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, path: filePath, reveal }),
    });
    await requireOk(res);
  },

  pickFolder: async (): Promise<string | null> => {
    const res = await authFetch(`${API_BASE}/fs/pick-folder`, { method: 'POST' });
    const data = await (await requireOk(res)).json();
    return data.path;
  },

  getDirectoryChildren: async (dirPath?: string, includeFiles = false): Promise<DirectoryChildrenResponse> => {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (includeFiles) params.set('includeFiles', 'true');
    const res = await authFetch(`${API_BASE}/fs/children?${params}`);
    return (await requireOk(res)).json();
  },

  searchFiles: async (rootPath: string, query: string): Promise<FileSearchResponse> => {
    const params = new URLSearchParams({ path: rootPath, q: query });
    const res = await authFetch(`${API_BASE}/fs/search?${params}`);
    return (await requireOk(res)).json();
  },

  getFileContent: async (filePath: string): Promise<FileContentResponse> => {
    const res = await authFetch(`${API_BASE}/fs/file?path=${encodeURIComponent(filePath)}`);
    return (await requireOk(res)).json();
  },

  getImageBlob: async (filePath: string): Promise<Blob> => {
    const res = await authFetch(`${API_BASE}/fs/image?path=${encodeURIComponent(filePath)}`);
    return (await requireOk(res)).blob();
  },

  findDefinition: async (filePath: string, symbol: string, line: number): Promise<DefinitionResponse> => {
    const params = new URLSearchParams({ path: filePath, symbol, line: String(line) });
    const res = await authFetch(`${API_BASE}/symbols/definition?${params}`);
    return (await requireOk(res)).json();
  },

  findReferences: async (filePath: string, symbol: string): Promise<ReferencesResponse> => {
    const params = new URLSearchParams({ path: filePath, symbol });
    const res = await authFetch(`${API_BASE}/symbols/references?${params}`);
    return (await requireOk(res)).json();
  },

  resolveImport: async (filePath: string, specifier: string): Promise<ResolveImportResponse> => {
    const params = new URLSearchParams({ path: filePath, specifier });
    const res = await authFetch(`${API_BASE}/symbols/resolve-import?${params}`);
    return (await requireOk(res)).json();
  },

  writeFile: async (data: WriteFileRequest): Promise<WriteFileResponse> => {
    const res = await authFetch(`${API_BASE}/fs/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return (await requireOk(res)).json();
  },

  getSessionOrder: async (): Promise<string[]> => {
    const res = await authFetch(`${API_BASE}/sessions/order`);
    const data = await (await requireOk(res)).json();
    return data.order;
  },

  saveSessionOrder: async (order: string[]): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    }));
  },

  getMosaicOrder: async (): Promise<string[]> => {
    const res = await authFetch(`${API_BASE}/sessions/mosaic-order`);
    const data = await (await requireOk(res)).json();
    return data.order;
  },

  saveMosaicOrder: async (order: string[]): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/mosaic-order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    }));
  },

  getGroups: async (): Promise<SessionGroup[]> => {
    const res = await authFetch(`${API_BASE}/sessions/groups`);
    const data = await (await requireOk(res)).json();
    return data.groups;
  },

  saveGroups: async (groups: SessionGroup[]): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/groups`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    }));
  },

  getWindows: async (): Promise<WindowRegistryState> => {
    const res = await authFetch(`${API_BASE}/windows`);
    await requireOk(res);
    return res.json();
  },

  createWindow: async (sessionId?: string): Promise<ArgusWindow> => {
    const res = await authFetch(`${API_BASE}/windows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    });
    await requireOk(res);
    return res.json();
  },

  assignWindow: async (sessionId: string, windowId: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, windowId }),
    }));
  },

  mergeAllWindows: async (targetId: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/${targetId}/merge-all`, { method: 'POST' }));
  },

  focusWindow: async (windowId: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/${windowId}/focus`, { method: 'POST' }));
  },

  renameWindow: async (windowId: string, label: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/${windowId}/label`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    }));
  },

  getSessionDiff: async (sessionId: string): Promise<GitDiffResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/diff`);
    return (await requireOk(res)).json();
  },

  getFileDiff: async (sessionId: string, filePath: string, contextLines: number, source: 'unstaged' | 'staged' | 'branch'): Promise<DiffFileResponse> => {
    const params = new URLSearchParams({ filePath, contextLines: String(contextLines), source });
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/diff-file?${params}`);
    return (await requireOk(res)).json();
  },

  getGitFileStatuses: async (sessionId: string): Promise<GitFileStatusResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-file-statuses`);
    return (await requireOk(res)).json();
  },

  stagePatch: async (sessionId: string, selection: PatchSelectionRequest): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-stage-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection),
    });
    return (await requireOk(res)).json();
  },

  discardPatch: async (sessionId: string, selection: PatchSelectionRequest): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-discard-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection),
    });
    return (await requireOk(res)).json();
  },

  undoDiscard: async (sessionId: string, undoId: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-undo-discard/${undoId}`, {
      method: 'POST',
    });
    return (await requireOk(res)).json();
  },

  gitCommit: async (sessionId: string, data: CommitRequest): Promise<CommitResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return (await requireOk(res)).json();
  },

  gitPush: async (sessionId: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-push`, {
      method: 'POST',
    });
    return (await requireOk(res)).json();
  },

  gitPull: async (sessionId: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-pull`, {
      method: 'POST',
    });
    return (await requireOk(res)).json();
  },

  gitAdd: async (sessionId: string, filePath: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return (await requireOk(res)).json();
  },

  gitUnstage: async (sessionId: string, filePath: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-unstage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return (await requireOk(res)).json();
  },

  gitIgnore: async (sessionId: string, filePath: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return (await requireOk(res)).json();
  },

  getGitLog: async (sessionId: string): Promise<GitLogResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-log`);
    return (await requireOk(res)).json();
  },

  getGitBranches: async (sessionId: string): Promise<GitBranchesResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-branches`);
    return (await requireOk(res)).json();
  },

  gitCheckout: async (sessionId: string, branch: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    return (await requireOk(res)).json();
  },

  gitCreateBranch: async (sessionId: string, name: string, from?: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-create-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, from }),
    });
    return (await requireOk(res)).json();
  },

  gitPullAndBranch: async (sessionId: string, branchName: string, baseBranch?: string): Promise<GitPullAndBranchResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-pull-and-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchName, baseBranch }),
    });
    return (await requireOk(res)).json();
  },

  getNgrokStatus: async (): Promise<NgrokStatus> => {
    const res = await authFetch(`${API_BASE}/ngrok/status`);
    return (await requireOk(res)).json();
  },

  startNgrok: async (port?: number, password?: string): Promise<NgrokStartResponse> => {
    const res = await authFetch(`${API_BASE}/ngrok/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(port != null && { port }), password }),
    });
    const data: NgrokStartResponse = await (await requireOk(res)).json();
    setToken(data.token);
    window.dispatchEvent(new CustomEvent('auth:authenticated'));
    return data;
  },

  stopNgrok: async (): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/ngrok/stop`, { method: 'POST' }));
  },

  recheckNgrok: async (): Promise<NgrokStatus> => {
    const res = await authFetch(`${API_BASE}/ngrok/recheck`, { method: 'POST' });
    return (await requireOk(res)).json();
  },

  getKeepAwake: async (): Promise<KeepAwakeStatus> => {
    const res = await authFetch(`${API_BASE}/keep-awake`);
    return (await requireOk(res)).json();
  },

  /** `durationMs: null` arms indefinitely. */
  armKeepAwake: async (durationMs: number | null): Promise<KeepAwakeStatus> => {
    const res = await authFetch(`${API_BASE}/keep-awake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMs }),
    });
    return (await requireOk(res)).json();
  },

  disarmKeepAwake: async (): Promise<KeepAwakeStatus> => {
    const res = await authFetch(`${API_BASE}/keep-awake`, { method: 'DELETE' });
    return (await requireOk(res)).json();
  },

  getConfig: async (): Promise<AppConfig> => {
    const res = await authFetch(`${API_BASE}/config`);
    return (await requireOk(res)).json();
  },

  updateConfig: async (data: Partial<AppConfig>): Promise<AppConfig> => {
    const res = await authFetch(`${API_BASE}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return (await requireOk(res)).json();
  },

  detectAgents: async (): Promise<AgentDetectionResponse> => {
    const res = await authFetch(`${API_BASE}/agents/detect`);
    return (await requireOk(res)).json();
  },

  getAuthStatus: async (): Promise<AuthStatus> => {
    const res = await authFetch(`${API_BASE}/auth/status`);
    return (await requireOk(res)).json();
  },

  login: async (password: string): Promise<AuthLoginResponse> => {
    const res = await authFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }, { intercept401: false });
    return (await requireOk(res)).json();
  },

  checkUpdate: async (): Promise<UpdateStatus> => {
    const res = await authFetch(`${API_BASE}/update/check`);
    return (await requireOk(res)).json();
  },

  applyUpdate: async (force?: boolean): Promise<UpdateApplyResponse> => {
    const res = await authFetch(`${API_BASE}/update/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: force ?? false }),
    });
    return (await requireOk(res)).json();
  },

  getDiffStructured: async (
    sessionId: string,
    filePath: string,
    contextLines: number,
    source: 'unstaged' | 'staged' | 'branch'
  ): Promise<StructuredDiffResponse> => {
    const params = new URLSearchParams({
      filePath,
      contextLines: String(contextLines),
      source,
    });
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/diff-file-structured?${params}`);
    return (await requireOk(res)).json();
  },

  getBlame: async (sessionId: string, filePath: string): Promise<BlameResponse> => {
    const params = new URLSearchParams({ filePath });
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-blame?${params}`);
    return (await requireOk(res)).json();
  },

  revertFileToHead: async (
    sessionId: string,
    filePath: string
  ): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-revert-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return (await requireOk(res)).json();
  },

  commitWithFiles: async (
    sessionId: string,
    message: string,
    amend: boolean,
    files: string[]
  ): Promise<CommitResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, amend, files }),
    });
    return (await requireOk(res)).json();
  },

  getChangelists: async (sessionId: string): Promise<ChangelistStateResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/changelists`);
    return (await requireOk(res)).json();
  },

  saveChangelists: async (
    sessionId: string,
    state: ChangelistStateResponse
  ): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/${sessionId}/changelists`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }));
  },

  getCommitSelection: async (sessionId: string): Promise<CommitSelectionState> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/commit-selection`);
    return (await requireOk(res)).json();
  },

  saveCommitSelection: async (
    sessionId: string,
    state: CommitSelectionState
  ): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/sessions/${sessionId}/commit-selection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }));
  },

  createFile: async (
    sessionId: string,
    filePath: string,
    isDir: boolean
  ): Promise<FileCrudResponse> => {
    const res = await authFetch(`${API_BASE}/fs/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, path: filePath, isDir }),
    });
    return (await requireOk(res)).json();
  },

  renameFile: async (
    sessionId: string,
    fromPath: string,
    toPath: string
  ): Promise<FileCrudResponse> => {
    const res = await authFetch(`${API_BASE}/fs/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, fromPath, toPath }),
    });
    return (await requireOk(res)).json();
  },

  deleteFile: async (
    sessionId: string,
    filePath: string
  ): Promise<FileCrudResponse> => {
    const res = await authFetch(`${API_BASE}/fs/file`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, path: filePath }),
    });
    return (await requireOk(res)).json();
  },

  moveFile: async (
    sessionId: string,
    fromPath: string,
    toPath: string
  ): Promise<FileCrudResponse> => {
    const res = await authFetch(`${API_BASE}/fs/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, fromPath, toPath }),
    });
    return (await requireOk(res)).json();
  },

  getWorktreeParentInfo: async (sessionId: string): Promise<{ parentRepoPath: string; defaultBranch: string }> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-worktree-parent-info`);
    return (await requireOk(res)).json();
  },

  mergeWorktree: async (sessionId: string, targetBranch?: string): Promise<{ success: boolean; targetBranch?: string; mergedBranch?: string; parentRepoPath?: string; error?: string }> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-merge-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBranch }),
    });
    return (await requireOk(res)).json();
  },

  getMergePreview: async (sessionId: string, targetBranch?: string): Promise<WorktreeMergePreviewResponse> => {
    const q = targetBranch ? `?targetBranch=${encodeURIComponent(targetBranch)}` : '';
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-merge-preview${q}`);
    return (await requireOk(res)).json();
  },

  /** Beta F8: what the Finish sheet shows (branch, upstream, PR, removability). */
  getWorktreeFinishInfo: async (sessionId: string): Promise<WorktreeFinishInfo> => {
    const res = await authFetch(`${API_BASE}/worktrees/sessions/${sessionId}/finish`);
    return (await requireOk(res)).json();
  },

  /** Beta F8: run Finish steps (server orders them and stops at the first failure). */
  finishWorktree: async (sessionId: string, steps: WorktreeFinishStep[], message?: string): Promise<WorktreeFinishResponse> => {
    const res = await authFetch(`${API_BASE}/worktrees/sessions/${sessionId}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps, message }),
    });
    return (await requireOk(res)).json();
  },

  /** Beta F8: end the session, then `git worktree remove` (never forced). */
  removeFinishedWorktree: async (sessionId: string): Promise<void> => {
    const res = await authFetch(`${API_BASE}/worktrees/sessions/${sessionId}/remove`, { method: 'POST' });
    await requireOk(res);
  },

  /** Beta F12: size of the handoff brief these options would produce (creates nothing). */
  previewHandoff: async (sessionId: string, req: Omit<HandoffRequest, 'preview'>, signal?: AbortSignal): Promise<HandoffPreviewResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, preview: true }),
      signal,
    });
    return (await requireOk(res)).json();
  },

  /** Beta F12: write the brief and start the new shell seeded with it. */
  handoffSession: async (sessionId: string, req: Omit<HandoffRequest, 'preview'>): Promise<HandoffResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return (await requireOk(res)).json();
  },

  /** F9 cross-session search over scrollback and transcripts. */
  searchSessions: async (q: string, signal?: AbortSignal, limit = 100): Promise<SearchResponse> => {
    const res = await authFetch(`${API_BASE}/search?${new URLSearchParams({ q, limit: String(limit) })}`, { signal });
    return (await requireOk(res)).json();
  },

  /** F16 janitor scan. `startup` marks the once-per-launch check (server sets `notify`). */
  getOrphans: async (startup = false): Promise<OrphanReport> => {
    const res = await authFetch(`${API_BASE}/maintenance/orphans${startup ? '?startup=1' : ''}`);
    return (await requireOk(res)).json();
  },

  killOrphans: async (pids: number[]): Promise<OrphanKillResponse> => {
    const res = await authFetch(`${API_BASE}/maintenance/orphans/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pids }),
    });
    return (await requireOk(res)).json();
  },

  /** F5: the user's Claude default permission mode (null when unset). */
  getClaudeDefaultMode: async (): Promise<string | null> => {
    const res = await authFetch(`${API_BASE}/auto-approval/claude-mode`);
    return ((await (await requireOk(res)).json()) as { defaultMode: string | null }).defaultMode;
  },

  /** F5: folders that have sessions or auto-approval rules. */
  getAutoApprovalFolders: async (): Promise<AutoApprovalFolder[]> => {
    const res = await authFetch(`${API_BASE}/auto-approval/folders`);
    return ((await (await requireOk(res)).json()) as { folders: AutoApprovalFolder[] }).folders;
  },

  getAutoApprovalRules: async (folder: string): Promise<AutoApprovalFolderState> => {
    const res = await authFetch(`${API_BASE}/auto-approval/rules?folder=${encodeURIComponent(folder)}`);
    return (await requireOk(res)).json();
  },

  addAutoApprovalRule: async (req: AddAutoApprovalRuleRequest): Promise<AutoApprovalRule> => {
    const res = await authFetch(`${API_BASE}/auto-approval/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return (await requireOk(res)).json();
  },

  removeAutoApprovalRule: async (folder: string, id: string): Promise<void> => {
    const res = await authFetch(
      `${API_BASE}/auto-approval/rules/${encodeURIComponent(id)}?folder=${encodeURIComponent(folder)}`,
      { method: 'DELETE' },
    );
    await requireOk(res);
  },

  gitInit: async (folderPath: string): Promise<void> => {
    const res = await authFetch(`${API_BASE}/worktrees/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    });
    await requireOk(res);
  },
};
