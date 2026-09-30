import { realpath, stat, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import type { AppConfig, LaunchRequest, LaunchWarning, ValidationResult } from '@argus/shared';
import type { AgentRegistry } from '../AgentRegistry.js';
import { promptArgs } from '../AgentRegistry.js';
import { shquote } from '../PtyManager.js';
import { validateFlags } from '../../utils/flags.js';

/** Folder files an agent loads on start. Their CONTENTS are hashed so a saved
 *  launcher notices hook/MCP/instruction edits, not just files appearing. */
export const AGENT_CONFIG_FILES = [
  '.claude/settings.json', '.claude/settings.local.json', '.mcp.json',
  'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.gemini/settings.json',
];
/** tmux caps one command near 16 KB; the tmux path quotes the agent line twice. */
export const MAX_QUOTED_BYTES = 12288;

export interface ValidateDeps { agentRegistry: AgentRegistry; config: AppConfig; home: string }

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
const displayWord = (s: string) => (SAFE_WORD.test(s) ? s : shquote(s));
const expandHome = (p: string, home: string) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p);

async function isDir(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

/** Sorted `"<relpath>#<sha256-hex-16>"` per existing config file, plus a bare
 *  `".claude/"` when that directory exists without any of the listed files. */
async function agentConfigEntries(folder: string): Promise<string[]> {
  const entries: string[] = [];
  for (const rel of AGENT_CONFIG_FILES) {
    let buf: Buffer;
    try { buf = await readFile(path.join(folder, rel)); } catch { continue; }
    entries.push(`${rel}#${createHash('sha256').update(buf).digest('hex').slice(0, 16)}`);
  }
  if (!entries.some((e) => e.startsWith('.claude/')) && (await isDir(path.join(folder, '.claude')))) entries.push('.claude/');
  return entries.sort();
}

/** The relpath part of an agent-config entry (drops the content hash). */
export const configEntryPath = (e: string) => e.split('#')[0];

export async function validateLaunch(req: LaunchRequest, deps: ValidateDeps): Promise<ValidationResult> {
  const agent = deps.agentRegistry.getById(req.agent, deps.config.customAgents ?? []);
  if (!agent) return { ok: false, error: `Unknown agent "${req.agent}"` };

  if (!req.folder || !path.isAbsolute(req.folder)) return { ok: false, error: 'Folder must be an absolute path' };
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
    if (req.prompt.trimStart().startsWith('-')) return { ok: false, error: 'Prompt must not start with "-"' };
    const pa = promptArgs(agent, req.prompt);
    if (!pa) return { ok: false, error: `Agent "${agent.name}" does not accept an initial prompt` };
    tail = pa;
  }
  // Prompt right after the command (spawn order): a bare flag can't take it as a value.
  const args = [...tail, ...req.flags];

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
  const folderAgentConfig = await agentConfigEntries(folder);
  if (folderAgentConfig.length) {
    warnings.push({ kind: 'folder-agent-config', detail: `Loads when the agent starts: ${folderAgentConfig.map(configEntryPath).join(', ')}` });
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
