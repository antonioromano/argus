import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '../../../components/primitives/index.js';
import { HighlightedCode } from '../../../syntax/HighlightedCode.js';

/**
 * A fenced code block in the Chat view, highlighted by the shared highlighter.
 * The copy button in the top-right corner copies the raw block text — the
 * usual case is a draft Claude wrote for Slack or Jira.
 */
export function ChatCodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <div className={`argus-chat-code${copied ? ' is-copied' : ''}`}>
      {language && <div className="argus-chat-code-lang">{language}</div>}
      <IconButton
        icon={copied ? Check : Copy}
        label={copied ? 'Copied' : 'Copy'}
        size="sm"
        variant="outlined"
        active={copied}
        onClick={copy}
        className="argus-chat-code-copy"
        // Opaque, so long lines scrolling under the button don't show through.
        style={{ background: copied ? 'var(--bg-3)' : 'var(--bg-2)' }}
      />
      <pre>
        <code>
          <HighlightedCode code={code} language={language} />
        </code>
      </pre>
    </div>
  );
}
