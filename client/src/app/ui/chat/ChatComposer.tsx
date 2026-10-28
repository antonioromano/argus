import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Plus, SendHorizontal, X } from 'lucide-react';
import type { ChatBlock, ChatCommand, SessionStatus } from '@argus/shared';
import { ContextMenu, Icon, IconButton, Tooltip, type ContextMenuEntry } from '../../../components/primitives/index.js';
import {
  PICKABLE_MODELS,
  PICKABLE_MODES,
  isImagePath,
  slashQuery,
  slashSuggestions,
  modelLabel,
  permissionModeLabel,
} from '../../../utils/chat.js';
import { formatPathsForPty } from '../../../utils/pathFormat.js';
import { ComposerHighlight } from './ComposerHighlight.js';
import { enterContinues, enterEdit, fenceEdit, indentEdit, type Edit } from './composerMarkdown.js';
import { newAttachmentKey as newKey, revokePreviews as revoke, useChatDraft, type DraftAttachment as Attachment } from './chatDrafts.js';

interface ChatComposerProps {
  /** Keys the unsent draft, which outlives this component (F11). */
  sessionId: string;
  status: SessionStatus;
  /**
   * Type `text` into Claude's prompt and submit it (the server presses Enter).
   * `preview` is the message as the composer showed it (typed text, then one
   * block per attachment), for the Chat view to show until the transcript has it.
   */
  onSubmit: (text: string, preview: ChatBlock[]) => void;
  /** Interrupt the running turn; while `running` the send button becomes Stop. */
  onStop?: () => void;
  /** A stop was asked for and the turn hasn't ended yet. */
  stopping?: boolean;
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
  /** Skills and custom commands for the `/` autocomplete (built-ins are always offered). */
  commands?: ChatCommand[];
  /** Claude Code's suggested next prompt: ghost text while the composer is empty, Tab takes it. */
  suggestion?: string;
  autoFocus?: boolean;
}

type ElectronFiles = { getPath: (name: string) => string | undefined };

const previewOf = (f: File) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : undefined);
/** The Stop button's name and tooltip; ⌘Esc is wired by ChatView. */
export const STOP_LABEL = 'Stop (⌘Esc)';

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

const canPickFiles = () => typeof window !== 'undefined' && 'electronFiles' in window;

type Menu = { kind: 'mode' | 'model'; x: number; y: number };

/**
 * Apply a list edit as one replacement of the changed span, through the
 * browser's own insertText so it lands on the textarea's undo stack (setting
 * `value` would wipe it). Falls back to setRangeText + an input event where
 * execCommand is missing (jsdom).
 */
function applyEdit(box: HTMLTextAreaElement, edit: Edit): void {
  const old = box.value;
  const next = edit.value;
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  const insert = next.slice(a, next.length - b);
  box.setSelectionRange(a, old.length - b);
  let done = false;
  try {
    done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, insert);
  } catch {
    done = false;
  }
  if (!done || box.value !== next) {
    // The prototype setter, so React's value tracker sees a change and fires onChange.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, next);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  box.setSelectionRange(edit.selStart, edit.selEnd);
}

/**
 * The Chat view's prompt box. Text goes to the agent through the pty, exactly
 * as if typed in the terminal (the server types it, presses Enter and checks it
 * was submitted). Enter sends, Shift+Enter adds a line; in a list or code
 * block Enter continues it and Cmd+Enter sends (D2: the Markdown is styled
 * live by a layer under the textarea, the text sent stays plain Markdown).
 * Attached files are sent as their paths, on a line
 * ahead of the text, which Claude Code reads (images become attachments) — the
 * same as dropping them on the terminal.
 */
export function ChatComposer({ sessionId, status, onSubmit, onStop, stopping, permissionMode, onSetMode, model, modelSet, onUploadImage, onShowTerminal, commands, suggestion, autoFocus }: ChatComposerProps) {
  // The draft lives in a store keyed by session, so unmounting (Terminal view,
  // another session, focus ↔ mosaic) keeps it; only sending clears it.
  const [draft, updateDraft] = useChatDraft(sessionId);
  const { text, attachments } = draft;
  const setText = (t: string) => updateDraft((d) => (d.text === t ? d : { ...d, text: t }));
  // Through the store, so an upload that finishes after unmount still lands.
  const setAttachments = (fn: (cur: Attachment[]) => Attachment[]) => updateDraft((d) => ({ ...d, attachments: fn(d.attachments) }));
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  // A model picked here shows until the transcript (or the next turn) reports the real one.
  const [picked, setPicked] = useState<{ id: string; set?: string; model?: string } | null>(null);
  if (picked && (picked.set !== modelSet || picked.model !== model)) setPicked(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  // `/` autocomplete: the highlighted row, and the text it was closed at with Esc.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosedAt, setSlashClosedAt] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  // Enter adds an item / line here instead of sending (drives the hint).
  const [continues, setContinues] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const exited = status === 'exited';
  // Shift+Tab and slash commands only make sense at Claude's prompt.
  const atPrompt = !exited && status !== 'waiting';

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // A typed ``` opens a code block with its closing fence. Native beforeinput:
  // it carries the typed text and can be cancelled before the textarea changes.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== 'insertText' || e.isComposing || !e.data) return;
      const edit = fenceEdit(box.value, box.selectionStart, box.selectionEnd, e.data);
      if (!edit) return;
      e.preventDefault();
      applyEdit(box, edit);
    };
    box.addEventListener('beforeinput', onBeforeInput);
    return () => box.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  const uploading = attachments.some((a) => !a.path && !a.failed);
  const ready = attachments.filter((a): a is Attachment & { path: string } => !!a.path);
  const canSend = !exited && !uploading && (text.trim().length > 0 || ready.length > 0);
  const query = slashClosedAt === text ? null : slashQuery(text, text.length);
  const suggestions = query === null ? [] : slashSuggestions(query, commands);
  // Not at a menu: there a slash command would only be typed into the menu.
  const slashOpen = suggestions.length > 0 && atPrompt;
  const active = slashOpen ? suggestions[Math.min(slashIndex, suggestions.length - 1)] : undefined;
  // F9: shown in place of the placeholder until Tab takes it or anything is typed.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ghost =
    suggestion && suggestion !== dismissed && text === '' && attachments.length === 0 && atPrompt && status !== 'running'
      ? suggestion
      : undefined;
  const complete = (c: ChatCommand) => {
    setText(`/${c.name} `);
    setSlashIndex(0);
    ref.current?.focus();
  };

  // The highlight layer scrolls with the textarea.
  const syncLayer = () => {
    const box = ref.current;
    const layer = layerRef.current;
    if (box && layer) layer.style.transform = `translate(${-box.scrollLeft}px, ${-box.scrollTop}px)`;
  };
  useLayoutEffect(syncLayer, [text]);

  const trackCaret = () => {
    const box = ref.current;
    if (!box) return;
    // Always set: two calls in one event would compare against a stale `continues`.
    setContinues(box.selectionStart === box.selectionEnd && enterContinues(box.value, box.selectionStart));
  };

  const send = () => {
    if (!canSend) return;
    // An ended list leaves an empty last line; it is not part of the message.
    // Paths go on their own line: on the text's first line a leading `- ` or `#`
    // would no longer start the line, and the sent message would lose it.
    const typed = text.replace(/(\n[ \t]*)+$/, '');
    const preview: ChatBlock[] = typed.trim() ? [{ kind: 'text', text: typed }] : [];
    for (const a of ready) preview.push(a.preview ? { kind: 'image' } : { kind: 'text', text: `\`${a.name}\`` });
    onSubmit([formatPathsForPty(ready.map((a) => a.path)), typed].filter((s) => s.trim()).join('\n'), preview);
    setContinues(false);
    revoke(attachments);
    updateDraft(() => ({ text: '', attachments: [] }));
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
        onSubmit(`/model ${m.id}`, []);
        setPicked({ id: m.id, set: modelSet, model });
      },
    })),
    { separator: true },
    {
      id: 'more',
      label: 'More models… (terminal)',
      onClick: () => {
        onShowTerminal?.();
        onSubmit('/model', []);
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
        {slashOpen && (
          <div className="argus-chat-slash" id="argus-chat-slash" role="listbox" aria-label="Slash commands">
            {suggestions.map((c) => (
              <div
                key={c.name}
                id={`argus-chat-slash-${c.name}`}
                role="option"
                aria-selected={c === active}
                className={`argus-chat-slash-item${c === active ? ' is-active' : ''}`}
                // mousedown, not click: the textarea keeps focus.
                onMouseDown={(e) => {
                  e.preventDefault();
                  complete(c);
                }}
                onMouseEnter={() => setSlashIndex(suggestions.indexOf(c))}
                ref={c === active ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
              >
                <span className="argus-chat-slash-name">/{c.name}</span>
                {c.description && <span className="argus-chat-slash-desc">{c.description}</span>}
              </div>
            ))}
          </div>
        )}
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
        <div className="argus-cmp-field">
        <ComposerHighlight ref={layerRef} text={text} />
        <textarea
          ref={ref}
          className="argus-cmp-input"
          value={text}
          // The height follows the text (CSS field-sizing), capped at ~45% of the view.
          rows={1}
          disabled={exited}
          placeholder={exited ? 'Session has exited — restart it to continue.' : (ghost ?? 'Message Claude…')}
          aria-label="Message"
          role="combobox"
          aria-expanded={slashOpen}
          aria-controls="argus-chat-slash"
          aria-autocomplete="list"
          aria-activedescendant={active ? `argus-chat-slash-${active.name}` : undefined}
          spellCheck
          onChange={(e) => {
            if (ghost) setDismissed(ghost);
            setText(e.target.value);
            setSlashIndex(0);
            trackCaret();
          }}
          onScroll={syncLayer}
          onSelect={trackCaret}
          onPaste={(e) => {
            // A screenshot on the clipboard is only bytes: upload it to get a path.
            const images = Array.from(e.clipboardData.files).filter(isImageFile);
            if (images.length === 0 || !onUploadImage || exited) return;
            e.preventDefault();
            upload(images, 'Pasted image');
          }}
          onKeyDown={(e) => {
            // Never during IME composition: Enter / Tab there confirm the candidate.
            if (e.nativeEvent.isComposing) return;
            if (slashOpen && active) {
              const move = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
              if (move) {
                e.preventDefault();
                const i = suggestions.indexOf(active);
                setSlashIndex((i + move + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSlashClosedAt(text);
                return;
              }
              // Tab always completes; Enter completes unless the command is typed in full (then it sends).
              const typedInFull = text.slice(1).toLowerCase() === active.name.toLowerCase();
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.altKey && !typedInFull)) {
                e.preventDefault();
                complete(active);
                return;
              }
            }
            // Tab takes the suggestion for editing; nothing reaches Claude until it is sent.
            if (ghost && e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              setDismissed(ghost);
              setText(ghost);
              return;
            }
            const box = e.currentTarget;
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              // In a list or code block Enter edits; Cmd/Ctrl+Enter always sends.
              const edit = e.metaKey || e.ctrlKey ? undefined : enterEdit(box.value, box.selectionStart, box.selectionEnd);
              if (!edit) {
                send();
                return;
              }
              applyEdit(box, edit);
              // The caret is final only now: the input event saw the end of the replaced span.
              trackCaret();
            } else if (e.key === 'Tab' && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const edit = indentEdit(box.value, box.selectionStart, box.selectionEnd, e.shiftKey);
              if (!edit) return;
              e.preventDefault();
              applyEdit(box, edit);
              trackCaret();
            }
          }}
        />
        </div>
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
          <span className={`argus-chat-hint${stopping ? ' is-stopping' : ''}`} aria-live="polite">
            {stopping
              ? 'Stopping…'
              : ghost
                ? 'Tab to use the suggestion'
                : continues
                  ? 'Enter for a new line · ⌘Enter to send'
                  : 'Enter to send · Shift+Enter for a new line'}
          </span>
          {status === 'running' && onStop ? (
            <Tooltip content={STOP_LABEL}>
              <button
                type="button"
                className={`argus-chat-stop${stopping ? ' is-stopping' : ''}`}
                aria-label={STOP_LABEL}
                onClick={onStop}
                disabled={stopping}
              >
                <span className="argus-chat-stop-glyph" aria-hidden />
              </button>
            </Tooltip>
          ) : (
            <IconButton icon={SendHorizontal} label="Send" size="sm" onClick={send} disabled={!canSend} />
          )}
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
