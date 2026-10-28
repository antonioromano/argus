import { memo, useState } from 'react';
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
  if (!d) return <div className="argus-chat-tool-empty">No details recorded.</div>;
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

/** Local open/closed state, mirrored into the view's `store`. */
function useOpen(key: string, store?: ToolOpenState): [boolean, () => void] {
  const [open, setOpen] = useState(() => store?.has(key) ?? false);
  const toggle = () => {
    const next = !open;
    if (store) {
      if (next) store.add(key);
      else store.delete(key);
    }
    setOpen(next);
  };
  return [open, toggle];
}

function Step({ step, store }: { step: ChatToolBlock; store?: ToolOpenState }) {
  const [open, toggle] = useOpen(`step:${step.id}`, store);
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

function GroupInner({ steps, store }: ChatToolGroupProps) {
  const [open, toggle] = useOpen(`group:${steps[0]?.id}`, store);
  if (steps.length === 1) {
    return (
      <div className="argus-chat-tools">
        <Step step={steps[0]} store={store} />
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
