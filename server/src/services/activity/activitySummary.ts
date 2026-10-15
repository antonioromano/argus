import type { ActivityEvent, ActivityEventType } from '@argus/shared';

/**
 * Beta F6: turn a Claude hook payload into one activity entry.
 *
 * `argus-signal --activity` forwards only the first ACTIVITY_PAYLOAD_CAP bytes
 * of the hook's stdin, so the payload is often truncated JSON (a PostToolUse
 * for a large Write carries the whole file). Parsing is therefore tolerant: a
 * full JSON.parse when the payload is whole, otherwise a scan for the few
 * string fields we read. Either way the summary is built from named fields
 * only — never from tool_response, and never from Write/Edit bodies.
 */

/** Bytes of hook stdin argus-signal forwards. The fields we read sit near the start. */
export const ACTIVITY_PAYLOAD_CAP = 16384;
/** Longest summary an entry ever carries. */
export const ACTIVITY_SUMMARY_MAX = 200;

/** The hook fields the summary builder reads. Everything else is dropped. */
export interface ParsedHook {
  event: string;
  toolName?: string;
  /** Only the tool_input keys a summary uses, string values only. */
  toolInput: Record<string, string>;
  prompt?: string;
  message?: string;
  agentType?: string;
  trigger?: string;
}

const INPUT_KEYS = [
  'command', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'description', 'subagent_type',
] as const;

/** Truncate to `max` characters (ellipsis included), one line, no control characters. */
export function clip(text: string, max = ACTIVITY_SUMMARY_MAX): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).trimEnd() + '…';
}

/**
 * First `"key": "<string>"` in `src` (escape-aware), decoded. A value cut off by
 * the cap is undefined, unless `partial` — then its head is returned (fine for
 * a command or a prompt that is clipped anyway; never for a path).
 */
function scanString(src: string, key: string, partial = false): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("|\\\\?$)`);
  const m = re.exec(src);
  if (!m) return undefined;
  if (m[2] !== '"' && !partial) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return undefined;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Parse a (possibly truncated) hook payload. Null when it names no hook event. */
export function parseHookPayload(raw: string): ParsedHook | null {
  const input: Record<string, string> = {};
  let obj: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  } catch {
    obj = null;
  }

  if (obj) {
    const event = str(obj.hook_event_name);
    if (!event) return null;
    const ti = obj.tool_input && typeof obj.tool_input === 'object' ? (obj.tool_input as Record<string, unknown>) : {};
    for (const k of INPUT_KEYS) {
      const v = str(ti[k]);
      if (v !== undefined) input[k] = v;
    }
    return {
      event,
      toolName: str(obj.tool_name),
      toolInput: input,
      prompt: str(obj.prompt),
      message: str(obj.message),
      agentType: str(obj.agent_type),
      trigger: str(obj.trigger),
    };
  }

  // Truncated: Claude writes its own top-level fields before tool_input, and
  // tool_input before tool_response, so the first match of each key is the
  // real one. Tool-input keys are only looked for after "tool_input".
  const event = scanString(raw, 'hook_event_name');
  if (!event) return null;
  const at = raw.indexOf('"tool_input"');
  if (at >= 0) {
    const tail = raw.slice(at);
    for (const k of INPUT_KEYS) {
      const v = scanString(tail, k, k === 'command');
      if (v !== undefined) input[k] = v;
    }
  }
  return {
    event,
    toolName: scanString(raw, 'tool_name'),
    toolInput: input,
    prompt: scanString(raw, 'prompt', true),
    message: scanString(raw, 'message'),
    agentType: scanString(raw, 'agent_type'),
    trigger: scanString(raw, 'trigger'),
  };
}

/** Tools whose entry is the file path alone (never content, never edit bodies). */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * One-line summary of a tool call. File tools give the path only; tools we do
 * not know give an empty summary rather than guess at which input is safe.
 */
export function summarizeTool(toolName: string, input: Record<string, string>): { summary: string; filePath?: string } {
  if (FILE_TOOLS.has(toolName)) {
    const p = input.file_path ?? input.notebook_path;
    return p ? { summary: clip(p), filePath: p } : { summary: '' };
  }
  switch (toolName) {
    case 'Bash':
      return { summary: clip(input.command ?? '') };
    case 'Glob':
    case 'Grep': {
      const pat = input.pattern ?? '';
      return { summary: clip(input.path ? `${pat} in ${input.path}` : pat) };
    }
    case 'WebFetch':
      return { summary: clip(input.url ?? '') };
    case 'WebSearch':
      return { summary: clip(input.query ?? '') };
    case 'Agent':
    case 'Task': {
      const who = input.subagent_type ?? '';
      const what = input.description ?? '';
      return { summary: clip(who && what ? `${who}: ${what}` : who || what) };
    }
    default:
      return { summary: '' };
  }
}

type Built = Omit<ActivityEvent, 'id' | 'at'>;

/** Map a parsed hook to an entry; null for events the timeline does not record. */
export function buildActivity(hook: ParsedHook): Built | null {
  let type: ActivityEventType;
  switch (hook.event) {
    case 'PostToolUse': {
      if (!hook.toolName) return null;
      const tool = clip(hook.toolName, 80);
      return { type: 'tool', tool, ...summarizeTool(hook.toolName, hook.toolInput) };
    }
    case 'SubagentStop':
      type = 'subagent';
      return { type, summary: clip(hook.agentType ? `${hook.agentType} finished` : 'Subagent finished') };
    case 'PreCompact':
      type = 'compact';
      return { type, summary: hook.trigger === 'auto' ? 'Auto-compact' : 'Manual compact' };
    case 'UserPromptSubmit':
      return { type: 'prompt', summary: clip(hook.prompt ?? '') };
    case 'Notification':
      return { type: 'notification', summary: clip(hook.message ?? '') };
    case 'Stop':
      return { type: 'stop', summary: 'Stopped, waiting for input' };
    default:
      return null;
  }
}

/** Raw payload → entry. The payload is capped again here, whatever the caller sent. */
export function activityFromPayload(raw: string): Built | null {
  const capped = raw.length > ACTIVITY_PAYLOAD_CAP ? raw.slice(0, ACTIVITY_PAYLOAD_CAP) : raw;
  const hook = parseHookPayload(capped);
  return hook ? buildActivity(hook) : null;
}
