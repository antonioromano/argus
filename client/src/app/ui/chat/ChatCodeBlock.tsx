import { HighlightedCode } from '../../../syntax/HighlightedCode.js';

/** A fenced code block in the Chat view, highlighted by the shared highlighter. */
export function ChatCodeBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="argus-chat-code">
      {language && <div className="argus-chat-code-lang">{language}</div>}
      <pre>
        <code>
          <HighlightedCode code={code} language={language} />
        </code>
      </pre>
    </div>
  );
}
