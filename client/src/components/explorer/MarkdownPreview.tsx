import { useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { resolveMarkdownLink, dispatchMarkdownLink } from '../../utils/resolveMarkdownLink.js';
import { symbolNavContext } from './registerSymbolProviders.js';
import { openExternal } from '../../utils/openExternal.js';
import { HighlightedCode } from '../../syntax/HighlightedCode.js';

interface MarkdownPreviewProps {
  source: string;
  /** Absolute path of the file being previewed — used to resolve relative links. */
  filePath: string;
  /** Session root, used to resolve leading-"/" links. */
  rootPath: string;
}

export function MarkdownPreview({ source, filePath, rootPath }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={containerRef}
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
        rehypePlugins={[rehypeSlug]}
        components={{
          a(props) {
            const { href, children, ...rest } = props;
            return (
              <a
                {...rest}
                href={href}
                onClick={(e) => {
                  if (!href) return;
                  e.preventDefault();
                  dispatchMarkdownLink(resolveMarkdownLink(href, filePath, rootPath), {
                    openExternal,
                    openInternal: (path) => symbolNavContext.onOpen(path, 1),
                    scrollToAnchor: (id) => {
                      // CSS.escape guards against ids with special chars.
                      containerRef.current
                        ?.querySelector(`#${CSS.escape(id)}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    },
                  });
                }}
              >
                {children}
              </a>
            );
          },
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
              <pre className="argus-md-code">
                <code>
                  <HighlightedCode code={String(children).replace(/\n$/, '')} language={langMatch[1]} />
                </code>
              </pre>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
