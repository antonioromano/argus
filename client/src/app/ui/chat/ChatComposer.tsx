import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Plus, SendHorizontal, X } from 'lucide-react';
import type { SessionStatus } from '@argus/shared';
import { ContextMenu, Icon, IconButton, type ContextMenuEntry } from '../../../components/primitives/index.js';
import {
  PICKABLE_MODELS,
  PICKABLE_MODES,
  isImagePath,
  modelLabel,
  permissionModeLabel,
} from '../../../utils/chat.js';
import { formatPathsForPty } from '../../../utils/pathFormat.js';

interface ChatComposerProps {
  status: SessionStatus;
  /** Type `text` into Claude's prompt and submit it (the server presses Enter). */
  onSubmit: (text: string) => void;
  /** Claude Code's permission mode (footer on screen, else the transcript). */
  permissionMode?: string;
  /** Ask the server to switch the permission mode; resolves false when it couldn't. */
  onSetMode?: (mode: string) => Promise<boolean>;
  /** Model of the latest turn, from the usage meter. */
  model?: string;
  /** Display name of the model last set with `/model` (from the transcript); wins over `model`. */
  modelSet?: string;
  /** Save an image with no file behind it (pasted from the clipboard) and resolve its path. */
  onUploadImage?: (file: File) => Promise<string>;
  /** Show the terminal (the full /model picker lives there). */
  onShowTerminal?: () => void;
  autoFocus?: boolean;
}

interface Attachment {
  key: string;
  /** Absolute path sent to Claude; undefined while a pasted image uploads. */
  path?: string;
  name: string;
  /** blob: URL of an image, for the thumbnail. */
  preview?: string;
  /** The upload failed: shown as an error, never sent. */
  failed?: boolean;
}

type ElectronFiles = { getPath: (name: string) => string | undefined };

let nextKey = 0;
const newKey = () => `att-${++nextKey}`;
const previewOf = (f: File) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : undefined);
const isImageFile = (f: File) => /^image\/(png|jpeg|gif|webp)$/.test(f.type);

/**
 * Split picked or dropped files into those with a path on disk (only Electron's
 * preload can see it: it records paths on drop and file-input change) and
 * images without one (a screenshot dragged from its preview), which get uploaded.
 */
function sortFiles(files: FileList | File[] | null): { withPath: Attachment[]; toUpload: File[] } {
  const bridge = (window as Window & { electronFiles?: ElectronFiles }).electronFiles;
  const withPath: Attachment[] = [];
  const toUpload: File[] = [];
  for (const f of Array.from(files ?? [])) {
    const path = bridge?.getPath(f.name);
    if (path) withPath.push({ key: newKey(), path, name: f.name, preview: isImagePath(path) ? previewOf(f) : undefined });
    else if (isImageFile(f)) toUpload.push(f);
  }
  return { withPath, toUpload };
}

const revoke = (list: Attachment[]) => list.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
const canPickFiles = () => typeof window !== 'undefined' && 'electronFiles' in window;

type Menu = { kind: 'mode' | 'model'; x: number; y: number };

/**
 * The Chat view's prompt box. Text goes to the agent through the pty, exactly
 * as if typed in the terminal (the server types it, presses Enter and checks it
 * was submitted). Enter sends, Shift+Enter adds a line. Attached files are sent as their paths
 * ahead of the text, which Claude Code reads (images become attachments) — the
 * same as dropping them on the terminal.
 */
export function ChatComposer({ status, onSubmit, permissionMode, onSetMode, model, modelSet, onUploadImage, onShowTerminal, autoFocus }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  // A model picked here shows until the transcript (or the next turn) reports the real one.
  const [picked, setPicked] = useState<{ id: string; set?: string; model?: string } | null>(null);
  if (picked && (picked.set !== modelSet || picked.model !== model)) setPicked(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => () => revoke(attachmentsRef.current), []);

  const uploading = attachments.some((a) => !a.path && !a.failed);
  const ready = attachments.filter((a): a is Attachment & { path: string } => !!a.path);
  const canSend = !exited && !uploading && (text.trim().length > 0 || ready.length > 0);
  const send = () => {
    if (!canSend) return;
    onSubmit([formatPathsForPty(ready.map((a) => a.path)), text].filter((s) => s.trim()).join(' '));
    revoke(attachments);
    setAttachments([]);
    setText('');
  };

  const attach = (list: Attachment[]) => {
    if (list.length === 0) return;
    setAttachments((cur) => {
      const have = new Set(cur.map((a) => a.path).filter(Boolean));
      const fresh = list.filter((a) => !a.path || !have.has(a.path));
      revoke(list.filter((a) => !fresh.includes(a)));
      return cur.concat(fresh);
    });
    ref.current?.focus();
  };

  const update = (key: string, patch: Partial<Attachment>) =>
    setAttachments((cur) => cur.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  /** Show images right away and upload them; each gets its path when saved. */
  const upload = (files: File[], name?: string) => {
    if (!onUploadImage || files.length === 0) return;
    const list = files.map((f) => ({ key: newKey(), name: name ?? f.name, preview: previewOf(f) }));
    attach(list);
    files.forEach((f, i) => {
      onUploadImage(f)
        .then((path) => update(list[i].key, { path }))
        .catch(() => update(list[i].key, { failed: true }));
    });
  };

  const addFiles = (files: FileList | File[] | null) => {
    const { withPath, toUpload } = sortFiles(files);
    attach(withPath);
    upload(toUpload);
  };

  const remove = (key: string) =>
    setAttachments((cur) => {
      revoke(cur.filter((a) => a.key === key));
      return cur.filter((a) => a.key !== key);
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

  const currentLabel = picked ? modelLabel(picked.id) : (modelSet ?? (model ? modelLabel(model) : undefined));
  const modelItems: ContextMenuEntry[] = [
    { header: 'Model' },
    ...PICKABLE_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      shortcut: currentLabel === m.label ? '✓' : undefined,
      onClick: () => {
        onSubmit(`/model ${m.id}`);
        setPicked({ id: m.id, set: modelSet, model });
      },
    })),
    { separator: true },
    {
      id: 'more',
      label: 'More models… (terminal)',
      onClick: () => {
        onShowTerminal?.();
        onSubmit('/model');
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
          if (e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {attachments.length > 0 && (
          <div className="argus-chat-attachments" aria-label="Attached files">
            {attachments.map((a) => (
              <div
                key={a.key}
                className={`argus-chat-attachment${a.path ? '' : a.failed ? ' is-failed' : ' is-uploading'}`}
                title={a.failed ? 'Upload failed — remove it and try again' : (a.path ?? 'Uploading…')}
              >
                {a.preview ? (
                  <img src={a.preview} alt={a.name} />
                ) : (
                  <div className="argus-chat-attachment-file">
                    <Icon icon={FileText} size={20} aria-hidden />
                    <span>{a.name}</span>
                  </div>
                )}
                <button type="button" className="argus-chat-attachment-remove" aria-label={`Remove ${a.name}`} onClick={() => remove(a.key)}>
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
          onPaste={(e) => {
            // A screenshot on the clipboard is only bytes: upload it to get a path.
            const images = Array.from(e.clipboardData.files).filter(isImageFile);
            if (images.length === 0 || !onUploadImage || exited) return;
            e.preventDefault();
            upload(images, 'Pasted image');
          }}
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
                  addFiles(e.target.files);
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
          title="Model"
          onClick={(e) => openMenu('model', e)}
        >
          {currentLabel ?? 'Model'}
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
