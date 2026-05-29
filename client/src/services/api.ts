import type { SessionInfo, CreateSessionRequest, PathCompletionResponse, DirectoryChildrenResponse, FileContentResponse, FileSearchResponse, GitDiffResponse, GitFileStatusResponse, NgrokStatus, NgrokStartResponse, AppConfig, AgentDetectionResponse, AuthStatus, AuthLoginResponse, UpdateStatus, UpdateApplyResponse, PatchSelectionRequest, PatchOperationResponse, CommitRequest, CommitResponse, GitLogResponse, WriteFileRequest, WriteFileResponse, GitBranchesResponse, DiffFileResponse, GitPullAndBranchResponse, StructuredDiffResponse, BlameResponse, ChangelistStateResponse, CommitSelectionState, FileCrudResponse, SessionGroup } from '@argus/shared';

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

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Authentication required');
  }
  return res;
}

export const api = {
  getSessions: async (): Promise<SessionInfo[]> => {
    const res = await authFetch(`${API_BASE}/sessions`);
    return res.json();
  },

  createSession: async (data: CreateSessionRequest): Promise<SessionInfo> => {
    const res = await authFetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create session');
    }
    return res.json();
  },

  deleteSession: async (id: string): Promise<void> => {
    await authFetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
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
    return res.json();
  },

  deleteWorktree: async (worktreePath: string, repoPath: string, force = false): Promise<void> => {
    const res = await authFetch(`${API_BASE}/worktrees`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktreePath, repoPath, force }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to delete worktree');
    }
  },

  restartSession: async (id: string): Promise<SessionInfo> => {
    const res = await authFetch(`${API_BASE}/sessions/${id}/restart`, { method: 'PATCH' });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to restart session');
    }
    return res.json();
  },

  getPathCompletions: async (path: string): Promise<string[]> => {
    const res = await authFetch(`${API_BASE}/fs/autocomplete?path=${encodeURIComponent(path)}`);
    const data: PathCompletionResponse = await res.json();
    return data.completions;
  },

  openPath: async (sessionId: string, filePath: string, reveal = false): Promise<void> => {
    const res = await authFetch(`${API_BASE}/fs/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, path: filePath, reveal }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to open');
    }
  },

  pickFolder: async (): Promise<string | null> => {
    const res = await authFetch(`${API_BASE}/fs/pick-folder`, { method: 'POST' });
    const data = await res.json();
    return data.path;
  },

  getDirectoryChildren: async (dirPath?: string, includeFiles = false): Promise<DirectoryChildrenResponse> => {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (includeFiles) params.set('includeFiles', 'true');
    const res = await authFetch(`${API_BASE}/fs/children?${params}`);
    return res.json();
  },

  searchFiles: async (rootPath: string, query: string): Promise<FileSearchResponse> => {
    const params = new URLSearchParams({ path: rootPath, q: query });
    const res = await authFetch(`${API_BASE}/fs/search?${params}`);
    return res.json();
  },

  getFileContent: async (filePath: string): Promise<FileContentResponse> => {
    const res = await authFetch(`${API_BASE}/fs/file?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error);
    }
    return res.json();
  },

  writeFile: async (data: WriteFileRequest): Promise<WriteFileResponse> => {
    const res = await authFetch(`${API_BASE}/fs/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  getSessionOrder: async (): Promise<string[]> => {
    const res = await authFetch(`${API_BASE}/sessions/order`);
    const data = await res.json();
    return data.order;
  },

  saveSessionOrder: async (order: string[]): Promise<void> => {
    await authFetch(`${API_BASE}/sessions/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
  },

  getGroups: async (): Promise<SessionGroup[]> => {
    const res = await authFetch(`${API_BASE}/sessions/groups`);
    const data = await res.json();
    return data.groups;
  },

  saveGroups: async (groups: SessionGroup[]): Promise<void> => {
    await authFetch(`${API_BASE}/sessions/groups`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    });
  },

  getSessionDiff: async (sessionId: string): Promise<GitDiffResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/diff`);
    return res.json();
  },

  getFileDiff: async (sessionId: string, filePath: string, contextLines: number, source: 'unstaged' | 'staged' | 'branch'): Promise<DiffFileResponse> => {
    const params = new URLSearchParams({ filePath, contextLines: String(contextLines), source });
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/diff-file?${params}`);
    return res.json();
  },

  getGitFileStatuses: async (sessionId: string): Promise<GitFileStatusResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-file-statuses`);
    return res.json();
  },

  stagePatch: async (sessionId: string, selection: PatchSelectionRequest): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-stage-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection),
    });
    return res.json();
  },

  discardPatch: async (sessionId: string, selection: PatchSelectionRequest): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-discard-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection),
    });
    return res.json();
  },

  undoDiscard: async (sessionId: string, undoId: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-undo-discard/${undoId}`, {
      method: 'POST',
    });
    return res.json();
  },

  gitCommit: async (sessionId: string, data: CommitRequest): Promise<CommitResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  gitPush: async (sessionId: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-push`, {
      method: 'POST',
    });
    return res.json();
  },

  gitPull: async (sessionId: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-pull`, {
      method: 'POST',
    });
    return res.json();
  },

  gitAdd: async (sessionId: string, filePath: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return res.json();
  },

  gitUnstage: async (sessionId: string, filePath: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-unstage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return res.json();
  },

  gitIgnore: async (sessionId: string, filePath: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return res.json();
  },

  getGitLog: async (sessionId: string): Promise<GitLogResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-log`);
    return res.json();
  },

  getGitBranches: async (sessionId: string): Promise<GitBranchesResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-branches`);
    return res.json();
  },

  gitCheckout: async (sessionId: string, branch: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    return res.json();
  },

  gitCreateBranch: async (sessionId: string, name: string, from?: string): Promise<PatchOperationResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-create-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, from }),
    });
    return res.json();
  },

  gitPullAndBranch: async (sessionId: string, branchName: string, baseBranch?: string): Promise<GitPullAndBranchResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-pull-and-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchName, baseBranch }),
    });
    return res.json();
  },

  getNgrokStatus: async (): Promise<NgrokStatus> => {
    const res = await fetch(`${API_BASE}/ngrok/status`);
    return res.json();
  },

  startNgrok: async (port?: number, password?: string): Promise<NgrokStartResponse> => {
    const res = await authFetch(`${API_BASE}/ngrok/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(port != null && { port }), password }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to start ngrok');
    }
    const data: NgrokStartResponse = await res.json();
    setToken(data.token);
    window.dispatchEvent(new CustomEvent('auth:authenticated'));
    return data;
  },

  stopNgrok: async (): Promise<void> => {
    const res = await authFetch(`${API_BASE}/ngrok/stop`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to stop ngrok');
    }
  },

  recheckNgrok: async (): Promise<NgrokStatus> => {
    const res = await authFetch(`${API_BASE}/ngrok/recheck`, { method: 'POST' });
    return res.json();
  },

  getConfig: async (): Promise<AppConfig> => {
    const res = await authFetch(`${API_BASE}/config`);
    return res.json();
  },

  updateConfig: async (data: Partial<AppConfig>): Promise<AppConfig> => {
    const res = await authFetch(`${API_BASE}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  detectAgents: async (): Promise<AgentDetectionResponse> => {
    const res = await authFetch(`${API_BASE}/agents/detect`);
    return res.json();
  },

  getAuthStatus: async (): Promise<AuthStatus> => {
    const res = await fetch(`${API_BASE}/auth/status`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });
    return res.json();
  },

  login: async (password: string): Promise<AuthLoginResponse> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Login failed');
    }
    return res.json();
  },

  checkUpdate: async (): Promise<UpdateStatus> => {
    const res = await authFetch(`${API_BASE}/update/check`);
    return res.json();
  },

  applyUpdate: async (force?: boolean): Promise<UpdateApplyResponse> => {
    const res = await authFetch(`${API_BASE}/update/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: force ?? false }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to apply update');
    }
    return res.json();
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
    return res.json();
  },

  getBlame: async (sessionId: string, filePath: string): Promise<BlameResponse> => {
    const params = new URLSearchParams({ filePath });
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-blame?${params}`);
    return res.json();
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
    return res.json();
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
    return res.json();
  },

  getChangelists: async (sessionId: string): Promise<ChangelistStateResponse> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/changelists`);
    return res.json();
  },

  saveChangelists: async (
    sessionId: string,
    state: ChangelistStateResponse
  ): Promise<void> => {
    await authFetch(`${API_BASE}/sessions/${sessionId}/changelists`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  },

  getCommitSelection: async (sessionId: string): Promise<CommitSelectionState> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/commit-selection`);
    return res.json();
  },

  saveCommitSelection: async (
    sessionId: string,
    state: CommitSelectionState
  ): Promise<void> => {
    await authFetch(`${API_BASE}/sessions/${sessionId}/commit-selection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
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
    return res.json();
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
    return res.json();
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
    return res.json();
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
    return res.json();
  },

  getWorktreeParentInfo: async (sessionId: string): Promise<{ parentRepoPath: string; defaultBranch: string }> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-worktree-parent-info`);
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to get worktree info');
    }
    return res.json();
  },

  mergeWorktree: async (sessionId: string, targetBranch?: string): Promise<{ success: boolean; targetBranch?: string; mergedBranch?: string; parentRepoPath?: string; error?: string }> => {
    const res = await authFetch(`${API_BASE}/sessions/${sessionId}/git-merge-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBranch }),
    });
    return res.json();
  },

  gitInit: async (folderPath: string): Promise<void> => {
    const res = await authFetch(`${API_BASE}/worktrees/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      throw new Error(err.error || 'Failed to initialize git repository');
    }
  },
};
