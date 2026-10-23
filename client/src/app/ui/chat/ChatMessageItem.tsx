import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatBlock, ChatMessage } from '@argus/shared';
import { Image as ImageIcon, Wrench, HelpCircle } from 'lucide-react';
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
  return (
    <div className={`argus-chat-msg ${user ? 'is-user' : 'is-assistant'}`} data-role={message.role}>
      {showRole && <div className="argus-chat-role eyebrow">{user ? 'You' : 'Claude'}</div>}
      <div className="argus-chat-body">
        {message.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </div>
  );
});
