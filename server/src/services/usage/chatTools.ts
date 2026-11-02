import type { ChatToolBlock, ChatToolDetail, ChatToolStatus } from '@argus/shared';

/**
 * Tool steps of the Chat view (F7): a `tool_use` becomes a labelled step, and
 * the `tool_result` a later user entry records is folded into it by id.
 */

/** Longest label (one line). */
const MAX_LABEL = 200;
/** Longest command / input / snippet in a step's details. */
export const MAX_TOOL_INPUT = 8000;
/** Longest tool output kept per step. */
export const MAX_TOOL_OUTPUT = 8000;
const MAX_ID = 128;
const MAX_NAME = 80;
const TRUNCATED = '\n… (truncated)';

function clipTo(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + TRUNCATED : text;
}

/** First non-empty line, clipped for a one-line label. */
function oneLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > MAX_LABEL ? `${line.slice(0, MAX_LABEL - 1)}…` : line;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** `path` relative to `cwd` when it lies inside it; else as given. */
export function displayPath(path: string, cwd?: string): string {
  if (!cwd) return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) && path.length > base.length ? path.slice(base.length) : path;
}

const words = (s: string) => s.replace(/[_-]+/g, ' ').trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * `mcp__plugin_figma_figma__get_screenshot` → "Figma · Get screenshot",
 * `mcp__claude_ai_Claude_Docs__batch` → "Claude Docs · Batch"; undefined for
 * a name that is not an MCP tool.
 */
export function mcpLabel(name: string): string | undefined {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m) return undefined;
  // Plugin servers are `plugin_<plugin>_<server>`; claude.ai connectors `claude_ai_<name>`.
  const server = words(m[1].replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/, ''))
    .split(' ')
    .map(capital)
    .join(' ');
  const tool = capital(words(m[2]).toLowerCase());
  return server && tool ? `${server} · ${tool}` : undefined;
}

/** "select:Read,Edit" → "Read, Edit"; a keyword query stays as typed. */
function toolSearchQuery(q: string): string {
  return q.startsWith('select:') ? q.slice(7).split(',').map((s) => s.trim()).filter(Boolean).join(', ') : q;
}

function pretty(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Object.keys(input).length === 0) return undefined;
  try {
    return clipTo(JSON.stringify(input, null, 2), MAX_TOOL_INPUT);
  } catch {
    return undefined;
  }
}

/** The human label of a call (see ChatToolBlock); the tool name when nothing better is known. */
export function toolLabel(name: string, input: any, cwd?: string): string {
  const i = input && typeof input === 'object' ? input : {};
  const path = str(i.file_path) ?? str(i.notebook_path);
  let label: string | undefined;
  switch (name) {
    case 'Bash':
      label = str(i.description) ?? str(i.command);
      break;
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      label = path && displayPath(path, cwd);
      break;
    case 'Grep':
    case 'Glob':
      label = str(i.pattern);
      break;
    case 'Agent':
    case 'Task':
      label = str(i.description);
      break;
    case 'ToolSearch': {
      const q = str(i.query);
      label = q ? `Loaded tools ${toolSearchQuery(q)}` : 'Loaded tools';
      break;
    }
    case 'WebFetch':
      label = str(i.url);
      break;
    case 'WebSearch':
      label = str(i.query);
      break;
    case 'Skill':
      label = str(i.skill) ?? str(i.command);
      break;
    case 'TodoWrite':
      label = 'Updated the todo list';
      break;
    default:
      label = mcpLabel(name);
  }
  return label ? oneLine(label) || name : name;
}

function inputDetail(name: string, input: any): ChatToolDetail | undefined {
  const i = input && typeof input === 'object' ? input : {};
  const path = str(i.file_path) ?? str(i.notebook_path);
  switch (name) {
    case 'Bash': {
      const command = str(i.command);
      return command ? { command: clipTo(command, MAX_TOOL_INPUT) } : undefined;
    }
    case 'Edit': {
      const d: ChatToolDetail = {};
      if (path) d.path = path;
      if (typeof i.old_string === 'string') d.oldText = clipTo(i.old_string, MAX_TOOL_INPUT);
      if (typeof i.new_string === 'string') d.newText = clipTo(i.new_string, MAX_TOOL_INPUT);
      return d;
    }
    case 'MultiEdit': {
      const edits: any[] = Array.isArray(i.edits) ? i.edits.filter((e: any) => e && typeof e === 'object') : [];
      const join = (k: string) => clipTo(edits.map((e) => (typeof e[k] === 'string' ? e[k] : '')).join('\n…\n'), MAX_TOOL_INPUT);
      const d: ChatToolDetail = { oldText: join('old_string'), newText: join('new_string') };
      if (path) d.path = path;
      return d;
    }
    case 'Write': {
      const d: ChatToolDetail = {};
      if (path) d.path = path;
      if (typeof i.content === 'string') d.newText = clipTo(i.content, MAX_TOOL_INPUT);
      return d;
    }
    case 'Read':
      // The path is the label; the output (file text) is all there is to show.
      return path ? { path } : undefined;
    default: {
      const json = pretty(i);
      return json ? { input: json } : undefined;
    }
  }
}

/** A `tool_use` content block → a pending step. */
export function toolBlockOf(b: any, cwd?: string): ChatToolBlock {
  const name = typeof b.name === 'string' && b.name ? b.name.slice(0, MAX_NAME) : 'tool';
  const block: ChatToolBlock = {
    kind: 'tool',
    id: typeof b.id === 'string' ? b.id.slice(0, MAX_ID) : '',
    name,
    label: toolLabel(name, b.input, cwd),
    status: 'pending',
  };
  const detail = inputDetail(name, b.input);
  if (detail) block.detail = detail;
  return block;
}

/** What a recorded `tool_result` says about its call. */
export interface ToolResult {
  id: string;
  status: Exclude<ChatToolStatus, 'pending'>;
  output?: string;
}

/**
 * Results that mean the call never ran: the user rejected it, a permission
 * rule denied it, a hook blocked it, or the turn was interrupted first.
 */
const BLOCKED_RE =
  /^(?:\[Request interrupted by user|The user doesn't want to (?:proceed|take this action)|Permission to use \S+.*\bdenied|Claude requested permissions to use|\S+ operation blocked by hook|Hook \S+ (?:blocked|denied))/i;

/** Text of a tool_result's content (a string, or text parts; images skipped). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** Claude Code wraps a tool's own error message in this tag. */
const TOOL_ERROR_RE = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/;
// eslint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * The `tool_result` blocks of a user entry's content. `toolUseResult` is the
 * entry's own summary (Claude Code writes "User rejected tool use" there).
 */
export function toolResultsOf(content: unknown, toolUseResult?: unknown): ToolResult[] {
  if (!Array.isArray(content)) return [];
  const out: ToolResult[] = [];
  const rejected = typeof toolUseResult === 'string' && /rejected/i.test(toolUseResult);
  for (const b of content) {
    if (!b || typeof b !== 'object' || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
    const text = resultText(b.content).replace(ANSI_RE, '').trim().replace(TOOL_ERROR_RE, '$1').trim();
    const status: ToolResult['status'] = b.is_error === true ? (rejected || BLOCKED_RE.test(text) ? 'blocked' : 'error') : 'ok';
    const r: ToolResult = { id: b.tool_use_id.slice(0, MAX_ID), status };
    if (text) r.output = clipTo(text, MAX_TOOL_OUTPUT);
    out.push(r);
  }
  return out;
}

/** `block` with `result` folded in (a new object; blocks sent earlier are never mutated). */
export function withResult(block: ChatToolBlock, result: ToolResult): ChatToolBlock {
  const next: ChatToolBlock = { ...block, status: result.status };
  if (result.output) next.detail = { ...block.detail, output: result.output };
  return next;
}
