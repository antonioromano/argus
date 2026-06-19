import { useState } from 'react';
import { Plus, X } from 'lucide-react';

export interface EditorTabStripProps {
  groupIndex: number;
  tabs: string[];
  active: string | null;
  /** The group's reusable preview tab (rendered italic), if any. */
  previewPath?: string | null;
  /** Path currently being dragged (dimmed), if any. */
  draggingPath?: string | null;
  dirtyMap: Record<string, boolean>;
  onActivate: (gi: number, path: string) => void;
  onClose: (gi: number, path: string) => void;
  /** Double-click a tab → pin (promote a preview tab). */
  onPin: (gi: number, path: string) => void;
  /** Begins a potential tab drag (workbench decides split/move on release). */
  onTabPointerDown: (e: React.PointerEvent, gi: number, path: string) => void;
  onAddClick: (gi: number) => void;
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function EditorTabStrip({
  groupIndex,
  tabs,
  active,
  previewPath,
  draggingPath,
  dirtyMap,
  onActivate,
  onClose,
  onPin,
  onTabPointerDown,
  onAddClick,
}: EditorTabStripProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 34,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--line-2)',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
      className="argus-tabstrip"
    >
      {tabs.map((path) => (
        <Tab
          key={path}
          path={path}
          active={path === active}
          preview={path === previewPath}
          dirty={!!dirtyMap[path]}
          dragging={path === draggingPath}
          onActivate={() => onActivate(groupIndex, path)}
          onClose={() => onClose(groupIndex, path)}
          onPin={() => onPin(groupIndex, path)}
          onPointerDown={(e) => onTabPointerDown(e, groupIndex, path)}
        />
      ))}
      <button
        onClick={() => onAddClick(groupIndex)}
        title="Open file (search)"
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          minWidth: 30,
          color: 'var(--fg-3)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg-0)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
      >
        <Plus size={14} strokeWidth={1.6} />
      </button>
    </div>
  );
}

interface TabProps {
  path: string;
  active: boolean;
  preview: boolean;
  dirty: boolean;
  dragging: boolean;
  onActivate: () => void;
  onClose: () => void;
  onPin: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
}

function Tab({ path, active, preview, dirty, dragging, onActivate, onClose, onPin, onPointerDown }: TabProps) {
  const [hover, setHover] = useState(false);
  const [closeHover, setCloseHover] = useState(false);
  return (
    <div
      onPointerDown={onPointerDown}
      onClick={onActivate}
      onDoubleClick={onPin}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '0 8px 0 11px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-xs)',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        borderRight: '1px solid var(--line-2)',
        opacity: dragging ? 0.35 : 1,
        background: active ? 'var(--bg-0)' : hover ? 'var(--bg-2)' : 'transparent',
        color: active ? 'var(--fg-0)' : hover ? 'var(--fg-1)' : 'var(--fg-2)',
      }}
    >
      {active && (
        <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--accent)' }} />
      )}
      <span style={{ color: active ? 'var(--accent)' : 'var(--fg-3)', fontSize: 'var(--t-tiny)' }}>TS</span>
      <span style={{ fontStyle: preview ? 'italic' : 'normal' }}>{baseName(path)}</span>
      {/* Fixed-width control box — reserves space so hover never reflows the row. */}
      <span
        role="button"
        aria-label="Close tab"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onMouseEnter={() => setCloseHover(true)}
        onMouseLeave={() => setCloseHover(false)}
        style={{
          width: 16,
          height: 16,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 3,
          flexShrink: 0,
          background: closeHover ? 'var(--bg-3)' : 'transparent',
          color: dirty && !closeHover ? 'var(--dirty)' : 'var(--fg-3)',
        }}
      >
        {dirty && !closeHover ? (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dirty)' }} />
        ) : hover || active || closeHover ? (
          <X size={12} strokeWidth={2} />
        ) : null}
      </span>
    </div>
  );
}
