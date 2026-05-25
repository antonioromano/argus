import { useEffect, useRef, useState } from 'react';
import AnsiToHtml from 'ansi-to-html';
import DOMPurify from 'dompurify';
import { useSocket } from '../../hooks/useSocket.js';

// DOMPurify config: only allow span tags with style attribute (what ansi-to-html produces)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DOMPURIFY_CONFIG: Record<string, any> = {
  ALLOWED_TAGS: ['span'],
  ALLOWED_ATTR: ['style'],
};

const MAX_LINES = 2000;

interface UseTerminalBufferResult {
  htmlLines: string[];
  rawLines: string[];
}

export function useTerminalBuffer(sessionId: string): UseTerminalBufferResult {
  const socket = useSocket();

  // AnsiToHtml is stateful — it tracks escape sequence state across calls.
  // Must be created once per mount, not per render.
  const converter = useRef(new AnsiToHtml({ escapeXML: true }));

  // Raw lines stored in a ref (mutable, not state) to avoid triggering re-renders on every append.
  const rawLines = useRef<string[]>([]);

  // Render trigger — incrementing forces a re-render to pick up rawLines changes.
  const [, setRenderTick] = useState(0);

  useEffect(() => {
    socket.emit('session:join', sessionId);

    const handleOutput = (payload: { sessionId: string; data: string }) => {
      if (payload.sessionId !== sessionId) return;

      // Strip null bytes, normalize line endings to \n only
      const cleaned = payload.data
        .replace(/\x00/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

      const incoming = cleaned.split('\n');
      rawLines.current = rawLines.current.concat(incoming);

      // Keep buffer bounded to MAX_LINES
      if (rawLines.current.length > MAX_LINES) {
        rawLines.current = rawLines.current.slice(rawLines.current.length - MAX_LINES);
      }

      // Trigger a re-render
      setRenderTick((t) => t + 1);
    };

    socket.on('session:output', handleOutput);

    return () => {
      // CRITICAL: leave the room on unmount to stop receiving output
      socket.emit('session:leave', sessionId);
      socket.off('session:output', handleOutput);
    };
  }, [socket, sessionId]);

  const htmlLines = rawLines.current.map((line) =>
    String(DOMPurify.sanitize(converter.current.toHtml(line), DOMPURIFY_CONFIG)),
  );

  return { htmlLines, rawLines: rawLines.current };
}

interface AnsiTerminalProps {
  sessionId: string;
  className?: string;
  style?: React.CSSProperties;
}

export function AnsiTerminal({ sessionId, className, style }: AnsiTerminalProps) {
  const { htmlLines } = useTerminalBuffer(sessionId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines arrive, unless the user has scrolled up
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [htmlLines]);

  // NOTE: dangerouslySetInnerHTML is intentional here.
  // All HTML is produced by ansi-to-html and then sanitized through DOMPurify
  // with a strict allowlist (span + style only) before being rendered.
  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        overflowY: 'scroll',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        fontFamily: "'SF Mono', ui-monospace, Menlo, Monaco, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        padding: '8px 12px',
        background: '#0D0D0F',
        color: 'rgba(255,255,255,0.8)',
        flex: 1,
        ...style,
      } as React.CSSProperties}
    >
      {htmlLines.map((html, i) => (
        // eslint-disable-next-line react/no-danger
        <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </div>
  );
}
