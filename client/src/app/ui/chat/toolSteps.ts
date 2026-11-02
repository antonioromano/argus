import type { ChatMessage, ChatToolBlock } from '@argus/shared';

/**
 * Tool steps of the Chat view (F7): runs of tool calls fold into one row with
 * a summary line ("Ran 5 commands, read 2 files (1 blocked)").
 */

function toolOnly(m: ChatMessage): boolean {
  return m.role === 'assistant' && m.blocks.length > 0 && m.blocks.every((b) => b.kind === 'tool');
}

/**
 * The Chat view's rows. Claude Code records each tool call as its own
 * assistant entry (and the results as user entries the server folds in), so
 * consecutive tool-only messages merge into one message: the first one's id
 * (the row keeps its key while the run grows) with all their tool blocks,
 * which ChatMessageItem then shows as one group.
 */
export function chatRows(messages: readonly ChatMessage[]): ChatMessage[] {
  const rows: ChatMessage[] = [];
  // Rows this call merged into (copies), so a message passed in is never mutated.
  const merged = new Set<ChatMessage>();
  for (const m of messages) {
    const last = rows[rows.length - 1];
    if (!toolOnly(m) || !last || !toolOnly(last)) {
      rows.push(m);
      continue;
    }
    if (!merged.has(last)) {
      const copy = { ...last, blocks: [...last.blocks] };
      rows[rows.length - 1] = copy;
      merged.add(copy);
      copy.blocks.push(...m.blocks);
    } else last.blocks.push(...m.blocks);
  }
  return rows;
}

interface Kind {
  /** Summary phrase: verb + noun, counted. */
  verb: string;
  one: string;
  many: string;
  /** Shown before a step's label ("Read src/a.ts"); none when the label says it all. */
  prefix?: string;
}

const KINDS: Record<string, Kind> = {
  Bash: { verb: 'ran', one: 'command', many: 'commands' },
  Read: { verb: 'read', one: 'file', many: 'files', prefix: 'Read' },
  Edit: { verb: 'edited', one: 'file', many: 'files', prefix: 'Edit' },
  MultiEdit: { verb: 'edited', one: 'file', many: 'files', prefix: 'Edit' },
  NotebookEdit: { verb: 'edited', one: 'file', many: 'files', prefix: 'Edit' },
  Write: { verb: 'wrote', one: 'file', many: 'files', prefix: 'Write' },
  Grep: { verb: 'ran', one: 'search', many: 'searches', prefix: 'Search' },
  Glob: { verb: 'ran', one: 'search', many: 'searches', prefix: 'Find' },
  WebFetch: { verb: 'fetched', one: 'page', many: 'pages', prefix: 'Fetch' },
  WebSearch: { verb: 'ran', one: 'web search', many: 'web searches', prefix: 'Search the web' },
  Agent: { verb: 'ran', one: 'agent', many: 'agents', prefix: 'Agent' },
  Task: { verb: 'ran', one: 'agent', many: 'agents', prefix: 'Agent' },
  Skill: { verb: 'used', one: 'skill', many: 'skills', prefix: 'Skill' },
  ToolSearch: { verb: 'loaded', one: 'tool set', many: 'tool sets' },
  TodoWrite: { verb: 'updated', one: 'todo list', many: 'todo lists' },
};
const MCP: Kind = { verb: 'called', one: 'MCP tool', many: 'MCP tools' };
const OTHER: Kind = { verb: 'used', one: 'tool', many: 'tools' };

function kindOf(name: string): Kind {
  return KINDS[name] ?? (name.startsWith('mcp__') ? MCP : OTHER);
}

/** The word shown before a step's label, when its label is a bare path or pattern. */
export function stepPrefix(step: ChatToolBlock): string | undefined {
  // A fallback label (the tool's name) needs no verb in front of it.
  return step.label === step.name ? undefined : kindOf(step.name).prefix;
}

/** "Ran 5 commands, read 2 files (1 blocked)". */
export function toolSummary(steps: readonly ChatToolBlock[]): string {
  // Keyed by phrase, so synonyms (Grep + Glob, Edit + MultiEdit, Agent + Task) count together.
  const counts = new Map<string, { k: Kind; n: number }>();
  for (const s of steps) {
    const k = kindOf(s.name);
    const key = `${k.verb}|${k.one}`;
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { k, n: 1 });
  }
  const parts = [...counts.values()].map(({ k, n }) => `${k.verb} ${n} ${n === 1 ? k.one : k.many}`);
  const text = parts.join(', ');
  const tally = (status: ChatToolBlock['status']) => steps.filter((s) => s.status === status).length;
  const notes = [
    [tally('blocked'), 'blocked'],
    [tally('error'), 'failed'],
    [tally('pending'), 'running'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, w]) => `${n} ${w}`);
  const out = text.charAt(0).toUpperCase() + text.slice(1);
  return notes.length ? `${out} (${notes.join(', ')})` : out;
}

/**
 * An Edit's old/new text with the lines both share at the start and end
 * dropped (one kept on each side as context): a cheap diff that is exact for
 * the usual single-hunk edit, never a full LCS.
 */
export function editLines(oldText: string, newText: string): { type: 'ctx' | 'del' | 'add'; text: string }[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const pre = start > 0 ? [{ type: 'ctx' as const, text: a[start - 1] }] : [];
  const post = end > 0 ? [{ type: 'ctx' as const, text: a[a.length - end] }] : [];
  return [
    ...pre,
    ...a.slice(start, a.length - end).map((text) => ({ type: 'del' as const, text })),
    ...b.slice(start, b.length - end).map((text) => ({ type: 'add' as const, text })),
    ...post,
  ];
}
