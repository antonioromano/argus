import { describe, it, expect } from 'vitest';
import type { ChatMessage, ChatToolBlock } from '@argus/shared';
import { chatRows, editLines, stepPrefix, toolSummary } from './toolSteps.js';

const step = (name: string, status: ChatToolBlock['status'] = 'ok', label = 'x'): ChatToolBlock => ({ kind: 'tool', id: `${name}-${status}-${label}`, name, label, status });
const tools = (id: string, ...blocks: ChatToolBlock[]): ChatMessage => ({ id, role: 'assistant', blocks });
const text = (id: string, role: ChatMessage['role'] = 'assistant'): ChatMessage => ({ id, role, blocks: [{ kind: 'text', text: id }] });

describe('chatRows', () => {
  it('folds consecutive tool-only assistant messages into one row keyed by the first', () => {
    const rows = chatRows([text('u', 'user'), tools('a1', step('Bash')), tools('a2', step('Read'), step('Grep')), text('a3'), tools('a4', step('Bash'))]);
    expect(rows.map((r) => r.id)).toEqual(['u', 'a1', 'a3', 'a4']);
    expect(rows[1].blocks.map((b) => b.kind === 'tool' && b.name)).toEqual(['Bash', 'Read', 'Grep']);
  });

  it('keeps mixed messages whole and never folds user or system rows', () => {
    const mixed: ChatMessage = { id: 'm', role: 'assistant', blocks: [{ kind: 'text', text: 'hi' }, step('Bash')] };
    const odd: ChatMessage = { id: 's', role: 'system', blocks: [step('Bash')] };
    expect(chatRows([mixed, odd, tools('a', step('Bash')), tools('b', step('Read'))]).map((r) => [r.id, r.blocks.length])).toEqual([
      ['m', 2],
      ['s', 1],
      ['a', 2],
    ]);
  });

  it('does not mutate the messages it reads', () => {
    const first = tools('a1', step('Bash'));
    const second = tools('a2', step('Read'));
    chatRows([first, second, tools('a3', step('Grep'))]);
    expect(first.blocks).toHaveLength(1);
    expect(second.blocks).toHaveLength(1);
    // A message with no run to join is passed through as is.
    expect(chatRows([first])[0]).toBe(first);
  });
});

describe('toolSummary', () => {
  it('counts each kind in order of first use, with blocked / failed / running notes', () => {
    const s = [step('Bash'), step('Read'), step('Bash'), step('Bash', 'blocked'), step('Read'), step('Bash'), step('Bash')];
    expect(toolSummary(s)).toBe('Ran 5 commands, read 2 files (1 blocked)');
    expect(toolSummary([step('Edit'), step('Write', 'error'), step('Grep', 'pending')])).toBe('Edited 1 file, wrote 1 file, ran 1 search (1 failed, 1 running)');
  });

  it('counts synonymous tools under one phrase', () => {
    expect(toolSummary([step('Grep'), step('Glob'), step('Glob')])).toBe('Ran 3 searches');
    expect(toolSummary([step('Edit'), step('MultiEdit'), step('Agent'), step('Task')])).toBe('Edited 2 files, ran 2 agents');
  });

  it('names MCP and unknown tools generically', () => {
    expect(toolSummary([step('mcp__figma__x'), step('mcp__slack__y'), step('Hologram')])).toBe('Called 2 MCP tools, used 1 tool');
  });
});

describe('stepPrefix', () => {
  it('prefixes bare paths and patterns, never a label that is the tool name', () => {
    expect(stepPrefix(step('Read', 'ok', 'a.ts'))).toBe('Read');
    expect(stepPrefix(step('Bash', 'ok', 'List files'))).toBeUndefined();
    expect(stepPrefix(step('Read', 'ok', 'Read'))).toBeUndefined();
  });
});

describe('editLines', () => {
  it('drops shared leading and trailing lines, keeping one of context each side', () => {
    expect(editLines('a\nb\nc\nd', 'a\nb\nX\nd')).toEqual([
      { type: 'ctx', text: 'b' },
      { type: 'del', text: 'c' },
      { type: 'add', text: 'X' },
      { type: 'ctx', text: 'd' },
    ]);
    expect(editLines('old', 'new')).toEqual([
      { type: 'del', text: 'old' },
      { type: 'add', text: 'new' },
    ]);
    expect(editLines('a\nb', 'a\nb\nc')).toEqual([
      { type: 'ctx', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });
});
