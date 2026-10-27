import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClaudeConversation } from '@argus/shared';
import { History, Terminal, X } from 'lucide-react';
import { Button, Icon, IconButton } from '../../../components/primitives/index.js';
import { relativeTime } from '../../panels/activityFormat.js';

interface ChatResumePickerProps {
  /** The folder's conversations, newest first. */
  load: () => Promise<ClaudeConversation[]>;
  /** Resume one: the Chat view sends `/resume <id>`. */
  onPick: (id: string) => void;
  /** Use Claude Code's own picker instead (sends `/resume` and shows the terminal). */
  onUseTerminal: () => void;
  onClose: () => void;
}

/**
 * /resume in the Chat view: the session folder's earlier conversations, with
 * a filter. Picking one sends `/resume <id>`, which Claude Code resumes
 * directly, without opening its terminal picker.
 */
export function ChatResumePicker({ load, onPick, onUseTerminal, onClose }: ChatResumePickerProps) {
  const [list, setList] = useState<ClaudeConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  // "5m" / "2d" ages are relative to when the picker opened.
  const [now] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    let live = true;
    loadRef
      .current()
      .then((l) => live && setList(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not list conversations'));
    inputRef.current?.focus();
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (list ?? []).filter((c) => !q || c.title.toLowerCase().includes(q) || c.id.startsWith(q));
  }, [list, filter]);
  const active = shown[Math.min(index, shown.length - 1)];

  return (
    <div className="argus-chat-resume" role="dialog" aria-label="Resume a conversation" data-testid="chat-resume">
      <div className="argus-chat-resume-head">
        <Icon icon={History} size={14} aria-hidden />
        <input
          ref={inputRef}
          className="argus-chat-resume-filter"
          placeholder="Resume a conversation…"
          aria-label="Filter conversations"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (shown.length) setIndex((i) => (Math.min(i, shown.length - 1) + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
            } else if (e.key === 'Enter' && active && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onPick(active.id);
            }
          }}
        />
        <Button variant="ghost" size="sm" icon={Terminal} onClick={onUseTerminal}>In terminal</Button>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>
      <div className="argus-chat-resume-list" role="listbox" aria-label="Conversations">
        {error ? (
          <div className="argus-chat-resume-empty">{error}</div>
        ) : list === null ? (
          <div className="argus-chat-resume-empty">Loading conversations…</div>
        ) : shown.length === 0 ? (
          <div className="argus-chat-resume-empty">{list.length ? 'No conversation matches.' : 'No earlier conversations in this folder.'}</div>
        ) : (
          shown.map((c) => (
            <div
              key={c.id}
              role="option"
              aria-selected={c === active}
              className={`argus-chat-resume-item${c === active ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(shown.indexOf(c))}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c.id)}
              ref={c === active ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
            >
              <span className="argus-chat-resume-title">{c.title}</span>
              {c.current && <span className="argus-chat-chip">current</span>}
              <span className="argus-chat-resume-when" title={new Date(c.updatedAt).toLocaleString()}>
                {relativeTime(c.updatedAt, now)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
