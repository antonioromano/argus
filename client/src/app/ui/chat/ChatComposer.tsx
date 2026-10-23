import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Plus, SendHorizontal, X } from 'lucide-react';
import type { SessionStatus } from '@argus/shared';
import { ContextMenu, Icon, IconButton, type ContextMenuEntry } from '../../../components/primitives/index.js';
import {
  CHAT_ENTER_DELAY_MS,
  PICKABLE_MODELS,
  PICKABLE_MODES,
  chatInputBytes,
  isImagePath,
  modelLabel,
  permissionModeLabel,
} from '../../../utils/chat.js';
import { formatPathsForPty } from '../../../utils/pathFormat.js';

interface ChatComposerProps {
  status: SessionStatus;
  /** Raw pty input, same path as ReplyBar and the terminal. */
  onSend: (data: string) => void;
  /** Claude Code's permission mode (footer on screen, else the transcript). */
  permissionMode?: string;
  /** Ask the server to switch the permission mode; resolves false when it couldn't. */
  onSetMode?: (mode: string) => Promise<boolean>;
  /** Model of the latest turn, from the usage meter. */
  model?: string;
  /** Show the terminal (the full /model picker lives there). */
  onShowTerminal?: () => void;
  autoFocus?: boolean;
}

interface Attachment {
  path: string;
  name: string;
  /** blob: URL of an image, for the thumbnail. */
  preview?: string;
}

type ElectronFiles = { getPath: (name: string) => string | undefined };

/** Picked or dropped files with their absolute paths. Only Electron's preload
 *  can see the paths (it records them on drop and file-input change). */
function toAttachments(files: FileList | File[] | null): Attachment[] {
  const bridge = (window as Window & { electronFiles?: ElectronFiles }).electronFiles;
  if (!bridge || !files) return [];
  const out: Attachment[] = [];
  for (const f of Array.from(files)) {
    const path = bridge.getPath(f.name);
    if (!path) continue;
    out.push({ path, name: f.name, preview: isImagePath(path) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : undefined });
  }
  return out;
}

const revoke = (list: Attachment[]) => list.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
const canPickFiles = () => typeof window !== 'undefined' && 'electronFiles' in window;

type Menu = { kind: 'mode' | 'model'; x: number; y: number };

/**
 * The Chat view's prompt box. Text goes to the agent through the pty, exactly
 * as if typed in the terminal: the text first, then Enter as a separate write.
 * Enter sends, Shift+Enter adds a line. Attached files are sent as their paths
 * ahead of the text, which Claude Code reads (images become attachments) — the
 * same as dropping them on the terminal.
 */
export function ChatComposer({ status, onSend, permissionMode, onSetMode, model, onShowTerminal, autoFocus }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  // A model picked here shows until the next turn reports the real one.
  const [picked, setPicked] = useState<{ id: string; over?: string } | null>(null);
  if (picked && picked.over !== model) setPicked(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Latest attachments for the unmount cleanup (their blob URLs).
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  const exited = status === 'exited';
  // Shift+Tab and slash commands only make sense at Claude's prompt.
  const atPrompt = !exited && status !== 'waiting';

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(
    () => () => {
      clearTimeout(enterTimer.current);
      revoke(attachmentsRef.current);
    },
    [],
  );

  const type = (data: string) => {
    onSend(chatInputBytes(data));
    clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => onSend('\r'), CHAT_ENTER_DELAY_MS);
  };

  const canSend = !exited && (text.trim().length > 0 || attachments.length > 0);
  const send = () => {
    if (!canSend) return;
    type([formatPathsForPty(attachments.map((a) => a.path)), text].filter((s) => s.trim()).join(' '));
    revoke(attachments);
    setAttachments([]);
    setText('');
  };

  const attach = (list: Attachment[]) => {
    if (list.length === 0) return;
    setAttachments((cur) => {
      const have = new Set(cur.map((a) => a.path));
      const fresh = list.filter((a) => !have.has(a.path));
      revoke(list.filter((a) => have.has(a.path)));
      return cur.concat(fresh);
    });
    ref.current?.focus();
  };

  const remove = (path: string) =>
    setAttachments((cur) => {
      revoke(cur.filter((a) => a.path === path));
      return cur.filter((a) => a.path !== path);
    });

  const openMenu = (kind: Menu['kind'], e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, x: r.left, y: r.top - 4 });
  };

  const modeItems: ContextMenuEntry[] = [
    { header: 'Permission mode' },
    ...PICKABLE_MODES.map((m) => ({
      id: m,
      label: permissionModeLabel(m),
      shortcut: m === permissionMode ? '✓' : undefined,
      onClick: () => {
        if (!onSetMode || m === permissionMode) return;
        setSwitchingMode(true);
        void onSetMode(m).finally(() => setSwitchingMode(false));
      },
    })),
  ];

  const current = picked?.id ?? model;
  const modelItems: ContextMenuEntry[] = [
    { header: 'Model' },
    ...PICKABLE_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      shortcut: current && modelLabel(current) === m.label ? '✓' : undefined,
      onClick: () => {
        type(`/model ${m.id}`);
        setPicked({ id: m.id, over: model });
      },
    })),
    { separator: true },
    {
      id: 'more',
      label: 'More models… (terminal)',
      onClick: () => {
        onShowTerminal?.();
        type('/model');
      },
    },
  ];

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
          const list = toAttachments(e.dataTransfer.files);
          if (list.length === 0) return;
          e.preventDefault();
          attach(list);
        }}
      >
        {attachments.length > 0 && (
          <div className="argus-chat-attachments" aria-label="Attached files">
            {attachments.map((a) => (
              <div key={a.path} className="argus-chat-attachment" title={a.path}>
                {a.preview ? (
                  <img src={a.preview} alt={a.name} />
                ) : (
                  <div className="argus-chat-attachment-file">
                    <Icon icon={FileText} size={20} aria-hidden />
                    <span>{a.name}</span>
                  </div>
                )}
                <button type="button" className="argus-chat-attachment-remove" aria-label={`Remove ${a.name}`} onClick={() => remove(a.path)}>
                  <Icon icon={X} size={10} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
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
                  attach(toAttachments(e.target.files));
                  e.target.value = '';
                }}
              />
            </>
          )}
          <div style={{ flex: 1 }} />
          <span className="argus-chat-hint">Enter to send · Shift+Enter for a new line</span>
          <IconButton icon={SendHorizontal} label="Send" size="sm" onClick={send} disabled={!canSend} />
        </div>
      </div>
      <div className="argus-chat-composer-meta">
        {permissionMode && (
          <button
            type="button"
            className="argus-chat-meta-btn"
            disabled={!atPrompt || !onSetMode || switchingMode}
            title="Permission mode"
            onClick={(e) => openMenu('mode', e)}
          >
            {switchingMode ? 'Switching…' : permissionModeLabel(permissionMode)}
            <Icon icon={ChevronDown} size={10} aria-hidden />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="argus-chat-meta-btn"
          disabled={!atPrompt}
          title={current ?? 'Model'}
          onClick={(e) => openMenu('model', e)}
        >
          {current ? modelLabel(current) : 'Model'}
          <Icon icon={ChevronDown} size={10} aria-hidden />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.kind === 'mode' ? modeItems : modelItems}
          onClose={() => setMenu(null)}
          placement="above"
        />
      )}
    </div>
  );
}
