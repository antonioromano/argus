/**
 * A fenced code block in the Chat view. Deliberately plain for now: the one
 * place to swap in shared syntax highlighting (roadmap B6, Shiki) later.
 */
export function ChatCodeBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="argus-chat-code">
      {language && <div className="argus-chat-code-lang">{language}</div>}
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
