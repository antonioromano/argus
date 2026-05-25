import { useMemo, useState, useCallback } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const GROUP_PREFIX = 'group::';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MacSessionSidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  /**
   * Kept for interface compatibility with App.tsx. Not rendered — the macOS
   * toolbar owns session-creation actions instead.
   */
  headerAction?: React.ReactNode;
  /** Override the default 200px width */
  width?: number;
  /** Ids of sessions that have pending unseen output */
  unreadSessions?: Set<string>;
  /** Called with the new flat session ID order after a drag-and-drop reorder */
  onReorder?: (newOrder: string[]) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusDotColor(status: SessionStatus): string {
  switch (status) {
    case 'running':
    case 'waiting':
      return 'var(--color-status-waiting)';
    case 'idle':
      return 'var(--color-status-idle)';
    default:
      return 'var(--color-status-exited)';
  }
}

const COLLAPSED_STORAGE_KEY = 'orchestrator:sidebar-collapsed-groups';

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function writeCollapsedGroups(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage errors
  }
}

// ─── MacSessionRow ────────────────────────────────────────────────────────────
// NSOutlineView-style source-list row.  No left-border accent, no status pill.
// Layout: drag handle → status dot → session name → git indicator → unread dot

function MacSessionRow({
  session,
  isActive,
  onSelect,
  unread,
}: {
  session: SessionInfo;
  isActive: boolean;
  onSelect: () => void;
  unread?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

  const [isHovered, setIsHovered] = useState(false);

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const dotColor = getStatusDotColor(session.status);
  // Unread dot only appears when the session is idle (not actively running/waiting)
  const isUnread = !!unread && session.status === 'idle';

  // Row background: active wins, then hover, then transparent
  let rowBackground: string;
  if (isActive) {
    rowBackground = 'var(--color-accent-subtle)';
  } else if (isHovered) {
    rowBackground = 'var(--color-bg-elevated)';
  } else {
    rowBackground = 'transparent';
  }

  return (
    <div ref={setNodeRef} style={sortableStyle}>
      <button
        onClick={onSelect}
        aria-current={isActive ? 'true' : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          width: '100%',
          minHeight: 28,
          padding: '4px 8px 4px 6px',
          border: 'none',
          borderRadius: 6,
          background: rowBackground,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--transition-fast)',
          marginBottom: 1,
          // Intentionally no borderLeft accent — that is the browser pattern
        }}
      >
        {/* Drag handle — invisible by default, subtle on row hover */}
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            cursor: 'grab',
            color: 'var(--color-text-muted)',
            opacity: isHovered ? 0.5 : 0,
            transition: 'opacity var(--transition-fast)',
          }}
        >
          <GripVertical size={11} strokeWidth={2} />
        </span>

        {/* Status dot — 6px circle with optional glow */}
        <span
          aria-label={`status: ${session.status}`}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            boxShadow: session.status !== 'exited' ? `0 0 5px ${dotColor}` : undefined,
            flexShrink: 0,
          }}
        />

        {/* Session name — monospace, truncated */}
        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {session.name}
          </span>

          {/* Git-changes indicator */}
          {session.hasGitChanges && (
            <AlertTriangle
              size={11}
              color="var(--color-status-waiting)"
              strokeWidth={2}
              style={{ flexShrink: 0 }}
            />
          )}
        </div>

        {/* Unread dot — shown only for idle sessions with unseen output */}
        {isUnread && (
          <span
            aria-label="unread output"
            title="New output — click to view"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-error)',
              flexShrink: 0,
            }}
          />
        )}
      </button>
    </div>
  );
}

// ─── MacGroupHeader ───────────────────────────────────────────────────────────
// Sortable group header with a drag handle for reordering folder groups.

function MacGroupHeader({
  folderPath,
  folderLabel,
  sessionCount,
  isCollapsed,
  onToggle,
}: {
  folderPath: string;
  folderLabel: string;
  sessionCount: number;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `${GROUP_PREFIX}${folderPath}` });

  const [isHovered, setIsHovered] = useState(false);

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={sortableStyle}>
      <button
        onClick={onToggle}
        title={folderPath}
        aria-expanded={!isCollapsed}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          width: '100%',
          height: 24,
          padding: '3px 6px 3px 2px',
          border: 'none',
          borderRadius: 4,
          background: isHovered ? 'var(--color-bg-elevated)' : 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--transition-fast)',
        }}
      >
        {/* Group drag handle */}
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            cursor: 'grab',
            color: 'var(--color-text-muted)',
            opacity: isHovered ? 0.5 : 0,
            transition: 'opacity var(--transition-fast)',
          }}
        >
          <GripVertical size={10} strokeWidth={2} />
        </span>

        {/* Collapse chevron */}
        {isCollapsed ? (
          <ChevronRight
            size={11}
            color="var(--color-text-muted)"
            strokeWidth={2}
            style={{ flexShrink: 0 }}
          />
        ) : (
          <ChevronDown
            size={11}
            color="var(--color-text-muted)"
            strokeWidth={2}
            style={{ flexShrink: 0 }}
          />
        )}

        {/* Folder path label */}
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
        >
          {folderLabel}
        </span>

        {/* Session count badge */}
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border-base)',
            borderRadius: 'var(--radius-pill)',
            padding: '0 4px',
            minWidth: 14,
            height: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {sessionCount}
        </span>
      </button>
    </div>
  );
}

// ─── MacSessionSidebar ───────────────────────────────────────────────────────

export function MacSessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  // headerAction intentionally not rendered — toolbar owns new-session action
  width,
  unreadSessions,
  onReorder,
}: MacSessionSidebarProps) {
  const activeCount = sessions.filter((s) => s.status !== 'exited').length;

  // Group sessions by folderPath, each group sorted newest-first
  const groups = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const s of sessions) {
      const arr = map.get(s.folderPath);
      if (arr) arr.push(s);
      else map.set(s.folderPath, [s]);
    }
    const entries = Array.from(map.entries()).map(([folderPath, items]) => {
      const sorted = [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return { folderPath, sessions: sorted };
    });
    entries.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
    return entries;
  }, [sessions]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroups());

  const toggleGroup = useCallback((folderPath: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      writeCollapsedGroups(next);
      return next;
    });
  }, []);

  // Flat ordered list and group IDs used by the DnD context
  const flatSessions = useMemo(() => groups.flatMap((g) => g.sessions), [groups]);
  const sessionIds = useMemo(() => flatSessions.map((s) => s.id), [flatSessions]);
  const groupIds = useMemo(
    () => groups.map((g) => `${GROUP_PREFIX}${g.folderPath}`),
    [groups],
  );
  // All sortable IDs: group headers + sessions (groups come first in the flat list)
  const allSortableIds = useMemo(
    () => [...groupIds, ...sessionIds],
    [groupIds, sessionIds],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onReorder) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      if (activeId.startsWith(GROUP_PREFIX)) {
        // Group drag: reorder groups, then emit new flat session order
        const activeGroupPath = activeId.slice(GROUP_PREFIX.length);
        // Resolve the target: if over a group ID use its path; if over a session, find its group
        const overGroupPath = overId.startsWith(GROUP_PREFIX)
          ? overId.slice(GROUP_PREFIX.length)
          : flatSessions.find((s) => s.id === overId)?.folderPath;
        if (!overGroupPath || activeGroupPath === overGroupPath) return;

        const oldIdx = groups.findIndex((g) => g.folderPath === activeGroupPath);
        const newIdx = groups.findIndex((g) => g.folderPath === overGroupPath);
        if (oldIdx === -1 || newIdx === -1) return;

        const reorderedGroups = arrayMove(groups, oldIdx, newIdx);
        onReorder(reorderedGroups.flatMap((g) => g.sessions.map((s) => s.id)));
      } else {
        // Session drag: reorder within flat list
        const oldIndex = sessionIds.indexOf(activeId);
        const newIndex = sessionIds.indexOf(overId.startsWith(GROUP_PREFIX) ? '' : overId);
        if (oldIndex === -1 || newIndex === -1) return;
        onReorder(arrayMove(sessionIds, oldIndex, newIndex));
      }
    },
    [groups, flatSessions, sessionIds, onReorder],
  );

  return (
    <div
      style={{
        width: width != null ? `${width}px` : '200px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        // Use sidebar-specific token; falls back to the surface token
        background: 'var(--color-bg-sidebar, var(--color-bg-surface))',
        backdropFilter: 'blur(20px) saturate(1.6)',
        // No borderRight — the parent layout handles the divider
        overflow: 'hidden',
      }}
    >
      {/* ── Sidebar header ─────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 10px',
          // Lighter separator matches macOS sidebar dividers
          borderBottom: '1px solid var(--color-border-ghost)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Sessions
        </span>

        {/* Active session count badge */}
        <span
          aria-label={`${activeCount} active sessions`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 14,
            height: 14,
            padding: '0 4px',
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border-base)',
            borderRadius: 'var(--radius-pill)',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {activeCount}
        </span>
      </div>

      {/* ── Session list with DnD context ──────────────────────── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={allSortableIds} strategy={verticalListSortingStrategy}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
            {groups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.folderPath);
              const folderLabel =
                group.folderPath.split('/').filter(Boolean).slice(-2).join('/') ||
                group.folderPath;

              return (
                <div key={group.folderPath} style={{ marginBottom: 2 }}>
                  <MacGroupHeader
                    folderPath={group.folderPath}
                    folderLabel={folderLabel}
                    sessionCount={group.sessions.length}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleGroup(group.folderPath)}
                  />

                  {/* Session rows — only rendered when group is expanded */}
                  {!isCollapsed &&
                    group.sessions.map((s) => (
                      <MacSessionRow
                        key={s.id}
                        session={s}
                        isActive={s.id === activeSessionId}
                        onSelect={() => onSelectSession(s.id)}
                        unread={unreadSessions?.has(s.id)}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
