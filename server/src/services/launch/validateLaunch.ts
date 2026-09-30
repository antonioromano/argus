import { realpath, stat, access } from 'fs/promises';
import path from 'path';
import type { AppConfig, LaunchRequest, LaunchWarning, ValidationResult } from '@argus/shared';
import type { AgentRegistry } from '../AgentRegistry.js';
import { promptArgs } from '../AgentRegistry.js';
import { shquote } from '../PtyManager.js';
import { validateFlags } from '../../utils/flags.js';

export const AGENT_CONFIG_FILES = ['.claude', '.mcp.json', 'CLAUDE.md'];
/** tmux caps one command near 16 KB; the tmux path quotes the agent line twice. */
export const MAX_QUOTED_BYTES = 12288;

export interface ValidateDeps { agentRegistry: AgentRegistry; config: AppConfig; home: string }

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
const displayWord = (s: string) => (SAFE_WORD.test(s) ? s : shquote(s));
const expandHome = (p: string, home: string) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p);

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function validateLaunch(req: LaunchRequest, deps: ValidateDeps): Promise<ValidationResult> {
  const agent = deps.agentRegistry.getById(req.agent, deps.config.customAgents ?? []);
  if (!agent) return { ok: false, error: `Unknown agent "${req.agent}"` };

  let folder: string;
  try {
    folder = await realpath(req.folder);
    if (!(await stat(folder)).isDirectory()) return { ok: false, error: 'Folder is not a directory' };
  } catch {
    return { ok: false, error: 'Folder does not exist' };
  }

  const flagError = validateFlags(req.flags);
  if (flagError) return { ok: false, error: flagError };

  let tail: string[] = [];
  if (req.prompt !== undefined) {
    const pa = promptArgs(agent, req.prompt);
    if (!pa) return { ok: false, error: `Agent "${agent.name}" does not accept an initial prompt` };
    tail = pa;
  }
  const args = [...req.flags, ...tail];

  const inner = `exec ${[agent.command, ...args.map(shquote)].join(' ')}`;
  if (Buffer.byteLength(shquote(inner)) > MAX_QUOTED_BYTES) {
    return { ok: false, error: `Command too long after quoting (max ${MAX_QUOTED_BYTES} bytes)` };
  }

  const warnings: LaunchWarning[] = [];
  const roots = await Promise.all(
    (deps.config.launchFolderRoots ?? []).map(async (r) => {
      const abs = expandHome(r, deps.home);
      try { return await realpath(abs); } catch { return path.resolve(abs); }
    }),
  );
  if (!roots.some((r) => folder === r || folder.startsWith(r + path.sep))) {
    warnings.push({ kind: 'folder-outside-roots', detail: `Outside ${(deps.config.launchFolderRoots ?? []).join(', ') || 'any configured root'}` });
  }
  const folderAgentConfig: string[] = [];
  for (const f of AGENT_CONFIG_FILES) if (await exists(path.join(folder, f))) folderAgentConfig.push(f);
  if (folderAgentConfig.length) {
    warnings.push({ kind: 'folder-agent-config', detail: `Loads when the agent starts: ${folderAgentConfig.join(', ')}` });
  }
  if (req.worktree) {
    warnings.push({ kind: 'worktree', detail: `Creates branch ${req.worktree} from ${req.base ?? 'HEAD'}` });
  }

  return {
    ok: true,
    value: {
      request: { ...req, folder },
      agentCommand: agent.command,
      args,
      command: [agent.command, ...args].map(displayWord).join(' '),
      warnings,
      folderAgentConfig,
    },
  };
}
