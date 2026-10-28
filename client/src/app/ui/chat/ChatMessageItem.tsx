import { memo, useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatBlock, ChatMessage, ChatToolBlock } from '@argus/shared';
import { Image as ImageIcon, HelpCircle, ChevronRight, Info, CircleStop } from 'lucide-react';
import { Icon } from '../../../components/primitives/index.js';
import { openExternal } from '../../../utils/openExternal.js';
import { api } from '../../../services/api.js';
import { ChatCodeBlock } from './ChatCodeBlock.js';
import { userMarkdown } from './userMarkdown.js';
import { ChatToolGroup, type ToolOpenState } from './ChatToolGroup.js';

const markdownComponents: Components = {
  // Links open in the system browser, never inside the sandboxed renderer.
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href && /^https?:\/\//i.test(href)) openExternal(href);
        }}
      >
        {children}
      </a>
    );
  },
  // Fenced blocks render through ChatCodeBlock; `pre` is unwrapped so the
  // block isn't nested in a second <pre>.
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const text = String(children ?? '');
    const lang = /language-([\w+#.-]+)/.exec(className ?? '')?.[1];
    // Inline code has no language class and no newline.
    if (!lang && !text.includes('\n')) return <code>{children}</code>;
    return <ChatCodeBlock language={lang} code={text.replace(/\n$/, '')} />;
  },
  // Remote images would be fetched from the renderer; show the alt text instead.
  img({ alt }) {
    return <span className="argus-chat-chip">{alt || 'image'}</span>;
  },
};

const imageChip = (
  <span className="argus-chat-chip">
    <Icon icon={ImageIcon} size={12} aria-hidden /> image
  </span>
);

/**
 * An attached image: a thumbnail when its file is still readable through the
 * session-scoped image route, else the plain chip (Argus's temp images, a
 * deleted file, a path outside every session folder).
 */
function ChatImage({ path }: { path?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.getImageBlob(path).then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => {},
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [path]);
  if (!url) return imageChip;
  return <img className="argus-chat-image" src={url} alt="" title={path} data-testid="chat-image" />;
}

/** First line of a command's output, for the collapsed summary. */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0];
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

/** `user`: a prompt, rendered as typed (userMarkdown). */
function Block({ block, user }: { block: ChatBlock; user: boolean }) {
  switch (block.kind) {
    case 'text':
      return (
        <div className="md-preview argus-chat-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
            {user ? userMarkdown(block.text) : block.text}
          </ReactMarkdown>
        </div>
      );
    case 'tool':
      // Runs of tool blocks are grouped by ChatMessageItem; a lone one lands here.
      return <ChatToolGroup steps={[block]} />;
    case 'image':
      return <ChatImage path={block.path} />;
    case 'command':
      return (
        <code className="argus-chat-command" data-testid="chat-command">
          <span className="argus-chat-command-name">{block.name}</span>
          {block.args && <span className="argus-chat-command-args"> {block.args}</span>}
        </code>
      );
    case 'output':
      // Closed by default: command output is reference, not conversation.
      return (
        <details className={`argus-chat-output${block.stream === 'stderr' ? ' is-stderr' : ''}`} data-testid="chat-output">
          <summary>
            <Icon icon={ChevronRight} size={12} className="argus-chat-output-caret" aria-hidden />
            <span className="argus-chat-output-label">{block.stream === 'stderr' ? 'Error output' : 'Output'}</span>
            <span className="argus-chat-output-preview">{firstLine(block.text)}</span>
          </summary>
          <pre className="argus-chat-output-text">{block.text}</pre>
        </details>
      );
    case 'notice': {
      // A stopped turn (F3) reads as a stop, not as information.
      const stopped = block.text.startsWith('Stopped');
      return (
        <span className={`argus-chat-notice${stopped ? ' is-stopped' : ''}`}>
          <Icon icon={stopped ? CircleStop : Info} size={12} aria-hidden /> {block.text}
        </span>
      );
    }
    default:
      return (
        <span className="argus-chat-chip argus-chat-chip-muted" title="Not shown in the Chat view — see the terminal">
          <Icon icon={HelpCircle} size={12} aria-hidden /> {block.type}
        </span>
      );
  }
}

interface ChatMessageItemProps {
  message: ChatMessage;
  /** First of a run of messages from the same role: shows the role label. */
  showRole: boolean;
  /** Sent from the composer, not in the transcript yet. */
  pending?: boolean;
  /** Open tool groups and steps (see ToolOpenState). */
  toolStore?: ToolOpenState;
}

type Part = { block: ChatBlock } | { tools: ChatToolBlock[] };

/** Blocks with each run of tool calls folded into one group. */
function partsOf(blocks: ChatBlock[]): Part[] {
  const out: Part[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (block.kind !== 'tool') out.push({ block });
    else if (last && 'tools' in last) last.tools.push(block);
    else out.push({ tools: [block] });
  }
  return out;
}

export const ChatMessageItem = memo(function ChatMessageItem({ message, showRole, pending, toolStore }: ChatMessageItemProps) {
  const user = message.role === 'user';
  const system = message.role === 'system';
  const command = user && message.blocks[0]?.kind === 'command';
  const cls = ['argus-chat-msg', user ? 'is-user' : system ? 'is-system' : 'is-assistant'];
  if (command) cls.push('is-command');
  if (message.echo) cls.push('is-echo');
  if (pending) cls.push('is-pending');
  return (
    <div
      className={cls.join(' ')}
      data-role={message.role}
      title={message.echo ? 'Sent from the Chat; Claude Code did not record this command in the transcript' : undefined}
    >
      {showRole && !system && <div className="argus-chat-role eyebrow">{user ? 'You' : 'Claude'}</div>}
      <div className="argus-chat-body">
        {partsOf(message.blocks).map((p, i) =>
          'tools' in p ? <ChatToolGroup key={i} steps={p.tools} store={toolStore} /> : <Block key={i} block={p.block} user={user} />,
        )}
      </div>
    </div>
  );
});
