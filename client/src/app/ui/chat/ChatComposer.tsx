import { useEffect, useRef, useState } from 'react';
import { Plus, SendHorizontal } from 'lucide-react';
import type { SessionStatus } from '@argus/shared';
import { IconButton } from '../../../components/primitives/index.js';
import { CHAT_ENTER_DELAY_MS, CYCLE_MODE_KEY, chatInputBytes, modelLabel, permissionModeLabel } from '../../../utils/chat.js';
import { formatPathsForPty } from '../../../utils/pathFormat.js';

interface ChatComposerProps {
  status: SessionStatus;
  /** Raw pty input, same path as ReplyBar and the terminal. */
  onSend: (data: string) => void;
  /** Claude Code's permission mode, from the transcript. */
  permissionMode?: string;
  /** Model of the latest turn, from the usage meter. */
  model?: string;
  autoFocus?: boolean;
}

type ElectronFiles = { getPath: (name: string) => string | undefined };

/** Absolute paths of picked or dropped files. Only Electron's preload can see
 *  them (it records each file's path on drop and file-input change). */
function filePaths(files: FileList | null): string[] {
  const bridge = (window as Window & { electronFiles?: ElectronFiles }).electronFiles;
  if (!bridge || !files) return [];
  return Array.from(files)
    .map((f) => bridge.getPath(f.name))
    .filter((p): p is string => !!p);
}

const canPickFiles = () => typeof window !== 'undefined' && 'electronFiles' in window;

/**
 * The Chat view's prompt box. Text goes to the agent through the pty, exactly
 * as if typed in the terminal: the text first, then Enter as a separate write.
 * Enter sends, Shift+Enter adds a line. Attached files are inserted as paths,
 * which Claude Code reads (images become attachments) — the same as dropping
 * them on the terminal.
 */
export function ChatComposer({ status, onSend, permissionMode, model, autoFocus }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exited = status === 'exited';
  // Shift+Tab answers a permission menu differently; only cycle at the prompt.
  const canCycleMode = !exited && status !== 'waiting';

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => () => clearTimeout(enterTimer.current), []);

  const send = () => {
    if (exited || !text.trim()) return;
    onSend(chatInputBytes(text));
    enterTimer.current = setTimeout(() => onSend('\r'), CHAT_ENTER_DELAY_MS);
    setText('');
  };

  const insertPaths = (paths: string[]) => {
    const formatted = formatPathsForPty(paths);
    if (!formatted) return;
    setText((t) => (t && !/\s$/.test(t) ? `${t} ` : t) + formatted + ' ');
    ref.current?.focus();
  };

  return (
    <div className="argus-chat-composer">
      <div
        className={`argus-chat-composer-box${dragOver ? ' is-drag-over' : ''}`}
        onDragOver={(e) => {
          if (exited || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          if (exited) return;
          const paths = filePaths(e.dataTransfer.files);
          if (paths.length === 0) return;
          e.preventDefault();
          insertPaths(paths);
        }}
      >
        <textarea
          ref={ref}
          value={text}
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          disabled={exited}
          placeholder={exited ? 'Session has exited — restart it to continue.' : 'Message Claude…'}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="argus-chat-composer-actions">
          {canPickFiles() && (
            <>
              <IconButton icon={Plus} label="Add files" size="sm" onClick={() => fileRef.current?.click()} disabled={exited} />
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                data-testid="chat-file-input"
                onChange={(e) => {
                  insertPaths(filePaths(e.target.files));
                  e.target.value = '';
                }}
              />
            </>
          )}
          <div style={{ flex: 1 }} />
          <span className="argus-chat-hint">Enter to send · Shift+Enter for a new line</span>
          <IconButton icon={SendHorizontal} label="Send" size="sm" onClick={send} disabled={exited || !text.trim()} />
        </div>
      </div>
      {(permissionMode || model) && (
        <div className="argus-chat-composer-meta">
          {permissionMode && (
            <button
              type="button"
              className="argus-chat-meta-btn"
              disabled={!canCycleMode}
              title="Permission mode — click to switch (Shift+Tab in the terminal)"
              onClick={() => onSend(CYCLE_MODE_KEY)}
            >
              {permissionModeLabel(permissionMode)}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {model && (
            <span className="argus-chat-meta-model" title={model}>
              {modelLabel(model)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
