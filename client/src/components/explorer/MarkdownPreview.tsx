import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../../context/theme-context.js';

interface MarkdownPreviewProps {
  source: string;
}

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  const { isDark } = useTheme();
  const codeStyle = isDark ? oneDark : oneLight;

  return (
    <div
      className="argus-scroll argus-md-preview"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        padding: 'var(--s-5)',
        background: 'var(--bg-0)',
        color: 'var(--fg-1)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--t-sm)',
        lineHeight: 1.6,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children, ...rest } = props;
            const langMatch = /language-(\w+)/.exec(className ?? '');
            const inline = !langMatch;
            if (inline) {
              return (
                <code
                  {...rest}
                  style={{
                    background: 'var(--bg-2)',
                    padding: '0 4px',
                    borderRadius: 'var(--r-1)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-xs)',
                  }}
                >
                  {children}
                </code>
              );
            }
            return (
              <SyntaxHighlighter
                language={langMatch?.[1] ?? 'text'}
                style={codeStyle}
                PreTag="div"
                customStyle={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--code-font-size, 13px)',
                  borderRadius: 'var(--r-2)',
                  margin: 'var(--s-3) 0',
                }}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
