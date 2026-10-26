import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatBlock, ChatMessage } from '@argus/shared';
import { Image as ImageIcon, Wrench, HelpCircle, ChevronRight, Info } from 'lucide-react';
import { Icon } from '../../../components/primitives/index.js';
import { openExternal } from '../../../utils/openExternal.js';
import { ChatCodeBlock } from './ChatCodeBlock.js';

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

/** First line of a command's output, for the collapsed summary. */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0];
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

function Block({ block }: { block: ChatBlock }) {
  switch (block.kind) {
    case 'text':
      return (
        <div className="md-preview argus-chat-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
            {block.text}
          </ReactMarkdown>
        </div>
      );
    case 'tool':
      return (
        <span className="argus-chat-chip" title="Tool call">
          <Icon icon={Wrench} size={12} aria-hidden /> {block.name}
        </span>
      );
    case 'image':
      return (
        <span className="argus-chat-chip">
          <Icon icon={ImageIcon} size={12} aria-hidden /> image
        </span>
      );
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
    case 'notice':
      return (
        <span className="argus-chat-notice">
          <Icon icon={Info} size={12} aria-hidden /> {block.text}
        </span>
      );
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
}

export const ChatMessageItem = memo(function ChatMessageItem({ message, showRole }: ChatMessageItemProps) {
  const user = message.role === 'user';
  const system = message.role === 'system';
  const command = user && message.blocks[0]?.kind === 'command';
  const cls = ['argus-chat-msg', user ? 'is-user' : system ? 'is-system' : 'is-assistant'];
  if (command) cls.push('is-command');
  if (message.echo) cls.push('is-echo');
  return (
    <div
      className={cls.join(' ')}
      data-role={message.role}
      title={message.echo ? 'Sent from the Chat; Claude Code did not record this command in the transcript' : undefined}
    >
      {showRole && !system && <div className="argus-chat-role eyebrow">{user ? 'You' : 'Claude'}</div>}
      <div className="argus-chat-body">
        {message.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </div>
  );
});
