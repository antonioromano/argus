import { memo, useReducer, useState } from 'react';
import type { ChatToolBlock } from '@argus/shared';
import type { LucideIcon } from 'lucide-react';
import { Ban, Bot, ChevronRight, CircleX, FilePen, FileText, Globe, ListTodo, LoaderCircle, Plug, Search, Sparkles, SquareTerminal, Wrench } from 'lucide-react';
import { Icon } from '../../../components/primitives/index.js';
import { HighlightedCode } from '../../../syntax/HighlightedCode.js';
import { langForPath } from '../../../syntax/highlighter.js';
import { editLines, stepPrefix, toolSummary } from './toolSteps.js';

/**
 * Open groups and steps by key. Owned by the Chat view, so a row the
 * virtualizer unmounts while scrolled away comes back as it was left.
 */
export type ToolOpenState = Set<string>;

const ICONS: Record<string, LucideIcon> = {
  Bash: SquareTerminal,
  Read: FileText,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Write: FilePen,
  Grep: Search,
  Glob: Search,
  WebSearch: Search,
  WebFetch: Globe,
  Agent: Bot,
  Task: Bot,
  Skill: Sparkles,
  TodoWrite: ListTodo,
};

function iconOf(name: string): LucideIcon {
  return ICONS[name] ?? (name.startsWith('mcp__') ? Plug : Wrench);
}

function StatusMark({ status }: { status: ChatToolBlock['status'] }) {
  switch (status) {
    case 'pending':
      return <Icon icon={LoaderCircle} size={12} className="argus-chat-tool-spin" aria-label="Running" />;
    case 'error':
      return <Icon icon={CircleX} size={12} className="argus-chat-tool-mark is-error" aria-label="Failed" />;
    case 'blocked':
      return <Icon icon={Ban} size={12} className="argus-chat-tool-mark is-blocked" aria-label="Blocked" />;
    default:
      return null;
  }
}

/** `<pre>` of code, highlighted when the language is known. */
function Code({ code, language }: { code: string; language?: string | null }) {
  return (
    <pre className="argus-chat-tool-code">
      <code>
        <HighlightedCode code={code} language={language} />
      </code>
    </pre>
  );
}

function EditDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const sign = { ctx: ' ', del: '-', add: '+' };
  return (
    <pre className="argus-chat-tool-code argus-chat-tool-diff" data-testid="chat-tool-diff">
      {editLines(oldText, newText).map((l, i) => (
        <div key={i} className={`argus-chat-tool-diff-${l.type}`}>
          {sign[l.type]} {l.text}
        </div>
      ))}
    </pre>
  );
}

function StepDetail({ step }: { step: ChatToolBlock }) {
  const d = step.detail;
  // A Read's detail is just its path until the result's text arrives.
  const shown = d && (d.command ?? d.newText ?? d.input ?? d.output) !== undefined;
  if (!d || !shown) return <div className="argus-chat-tool-empty">No details recorded.</div>;
  const lang = d.path ? langForPath(d.path) : null;
  return (
    <div className="argus-chat-tool-detail">
      {d.command !== undefined && <Code code={d.command} language="bash" />}
      {d.oldText !== undefined && d.newText !== undefined ? (
        <EditDiff oldText={d.oldText} newText={d.newText} />
      ) : (
        d.newText !== undefined && <Code code={d.newText} language={lang} />
      )}
      {d.input !== undefined && <Code code={d.input} language="json" />}
      {d.output !== undefined && (
        <pre className={`argus-chat-output-text argus-chat-tool-output${step.status === 'error' || step.status === 'blocked' ? ' is-error' : ''}`}>
          {d.output}
        </pre>
      )}
    </div>
  );
}

/**
 * Open/closed state read from `store` (keys shared across the view, so the
 * id must be known; an id-less call keeps its state to itself). Opening also
 * opens `also`: a lone step opens its group, so the step stays in view when
 * the next call turns the row into a summary.
 */
function useOpen(id: string, kind: 'step' | 'group', store: ToolOpenState, also?: string): [boolean, () => void] {
  const [local] = useState<ToolOpenState>(() => new Set());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const s = id ? store : local;
  const key = `${kind}:${id}`;
  const open = s.has(key);
  const toggle = () => {
    if (open) s.delete(key);
    else {
      s.add(key);
      if (also && id) s.add(also);
    }
    rerender();
  };
  return [open, toggle];
}

function Step({ step, store, group }: { step: ChatToolBlock; store: ToolOpenState; group?: string }) {
  const [open, toggle] = useOpen(step.id, 'step', store, group);
  const prefix = stepPrefix(step);
  return (
    <div className={`argus-chat-tool-step${open ? ' is-open' : ''}`} data-testid="chat-tool-step" data-status={step.status}>
      <button type="button" className="argus-chat-tool-head" aria-expanded={open} onClick={toggle} title={step.name}>
        <Icon icon={ChevronRight} size={12} className="argus-chat-tool-caret" aria-hidden />
        <Icon icon={iconOf(step.name)} size={12} className="argus-chat-tool-icon" aria-hidden />
        {prefix && <span className="argus-chat-tool-verb">{prefix}</span>}
        <span className="argus-chat-tool-label">{step.label}</span>
        <StatusMark status={step.status} />
      </button>
      {open && <StepDetail step={step} />}
    </div>
  );
}

interface ChatToolGroupProps {
  /** Calls in order; a single one shows as its own step, no summary. */
  steps: ChatToolBlock[];
  store?: ToolOpenState;
}

function GroupInner({ steps, store: given }: ChatToolGroupProps) {
  const [own] = useState<ToolOpenState>(() => new Set());
  const store = given ?? own;
  const first = steps[0]?.id ?? '';
  const [open, toggle] = useOpen(first, 'group', store);
  if (steps.length === 1) {
    return (
      <div className="argus-chat-tools">
        <Step step={steps[0]} store={store} group={`group:${first}`} />
      </div>
    );
  }
  const status = steps.some((s) => s.status === 'pending') ? 'pending' : undefined;
  return (
    <div className={`argus-chat-tools${open ? ' is-open' : ''}`} data-testid="chat-tool-group">
      <button type="button" className="argus-chat-tool-head argus-chat-tool-summary" aria-expanded={open} onClick={toggle}>
        <span className="argus-chat-tool-label">{toolSummary(steps)}</span>
        {status && <StatusMark status={status} />}
        <Icon icon={ChevronRight} size={12} className="argus-chat-tool-caret" aria-hidden />
      </button>
      {open && (
        <div className="argus-chat-tool-steps">
          {steps.map((s, i) => (
            <Step key={s.id || i} step={s} store={store} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The Chat view rebuilds the steps array on every update; only changed steps re-render it. */
function sameSteps(a: ChatToolGroupProps, b: ChatToolGroupProps): boolean {
  return a.store === b.store && a.steps.length === b.steps.length && a.steps.every((s, i) => s === b.steps[i]);
}

/** A run of tool calls: "Ran 5 commands, read 2 files (1 blocked) ▸", expandable to its steps (F7). */
export const ChatToolGroup = memo(GroupInner, sameSteps);
