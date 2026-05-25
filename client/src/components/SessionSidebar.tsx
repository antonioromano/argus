import { useMemo, useState, useCallback, type ReactNode } from 'react';
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

interface SessionSidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  /** Optional element rendered next to the "Sessions" header label */
  headerAction?: ReactNode;
  className?: string;
  /** Override the default 200px width */
  width?: number;
  /** Ids of sessions that have pending unseen output (shown as a red "!" badge) */
  unreadSessions?: Set<string>;
  /** Called with the new flat session ID order after a drag-and-drop reorder */
  onReorder?: (newOrder: string[]) => void;
}

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

function getStatusBadgeStyle(status: SessionStatus): { background: string; color: string; label: string } {
  switch (status) {
    case 'running':
      return {
        background: 'rgba(48,209,88,0.15)',
        color: '#30D158',
        label: 'running',
      };
    case 'waiting':
      return {
        background: 'rgba(255,214,10,0.15)',
        color: '#FFD60A',
        label: 'waiting',
      };
    default:
      return {
        background: 'rgba(255,255,255,0.07)',
        color: 'rgba(255,255,255,0.3)',
        label: 'idle',
      };
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
    // ignore
  }
  return new Set();
}

function writeCollapsedGroups(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

/** Individual sortable session row with drag handle and status badge */
function SortableSessionRow({
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
    opacity: isDragging ? 0.5 : 1,
  };

  const dotColor = getStatusDotColor(session.status);
  const badge = getStatusBadgeStyle(session.status);
  const isUnread = !!unread && session.status === 'idle';

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
          gap: '6px',
          width: '100%',
          padding: '6px 8px 6px 18px',
          border: 'none',
          borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
          borderRadius: 'var(--radius-sm)',
          background: isActive
            ? 'var(--color-surface-bright, var(--color-bg-surface))'
            : isHovered
            ? 'var(--color-bg-elevated)'
            : 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--transition-fast)',
          marginBottom: '2px',
        }}
      >
        {/* Drag handle — always visible at low opacity, increases on row hover */}
        <span
          {...attributes}
          {...listeners}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            cursor: 'grab',
            color: 'var(--color-text-muted)',
            opacity: isHovered ? 0.8 : 0.25,
            marginLeft: '-10px',
            marginRight: '2px',
            transition: 'opacity var(--transition-fast)',
            // Prevent the drag handle click from also firing the button onClick
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} strokeWidth={2} />
        </span>

        {/* Status dot */}
        <span
          aria-label={`status: ${session.status}`}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            boxShadow: session.status !== 'exited' ? `0 0 6px ${dotColor}` : undefined,
            flexShrink: 0,
          }}
        />

        {/* Session name */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-mono)',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {session.name}
            </span>
            {session.hasGitChanges && (
              <AlertTriangle size={11} color="var(--color-status-waiting)" strokeWidth={2} style={{ flexShrink: 0 }} />
            )}
          </div>
        </div>

        {/* Status badge pill */}
        <span
          aria-label={`session status: ${badge.label}`}
          style={{
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 4,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            marginLeft: 'auto',
            flexShrink: 0,
            background: badge.background,
            color: badge.color,
          }}
        >
          {badge.label}
        </span>

        {/* Unread indicator */}
        {isUnread && (
          <span
            aria-label="unread output"
            title="New output — click to view"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              fontSize: '10px',
              fontWeight: 700,
              color: '#ffffff',
              background: 'var(--color-error)',
              borderRadius: '50%',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            !
          </span>
        )}
      </button>
    </div>
  );
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  headerAction,
  className,
  width,
  unreadSessions,
  onReorder,
}: SessionSidebarProps) {
  const activeCount = sessions.filter((s) => s.status !== 'exited').length;

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

  // Flat session list in group-then-within-group order — used for DnD context
  const flatSessions = useMemo(() => groups.flatMap((g) => g.sessions), [groups]);
  const sessionIds = useMemo(() => flatSessions.map((s) => s.id), [flatSessions]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onReorder) return;
      const oldIndex = sessionIds.indexOf(active.id as string);
      const newIndex = sessionIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      onReorder(arrayMove(sessionIds, oldIndex, newIndex));
    },
    [sessionIds, onReorder],
  );

  return (
    <div
      className={className}
      style={{
        width: width != null ? `${width}px` : '200px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-surface)',
        borderRight: '1px solid var(--color-border-base)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid var(--color-border-base)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
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
          <span
            aria-label={`${activeCount} active sessions`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 16,
              height: 16,
              padding: '0 5px',
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
        {headerAction}
      </div>

      {/* Session list with DnD context */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
            {groups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.folderPath);
              const folderLabel = group.folderPath.split('/').slice(-2).join('/') || group.folderPath;
              return (
                <div key={group.folderPath} style={{ marginBottom: '4px' }}>
                  {/* Group header / collapse toggle */}
                  <button
                    onClick={() => toggleGroup(group.folderPath)}
                    title={group.folderPath}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      width: '100%',
                      padding: '4px 6px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-elevated)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} color="var(--color-text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
                    ) : (
                      <ChevronDown size={12} color="var(--color-text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
                    )}
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
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
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-bg-base)',
                        border: '1px solid var(--color-border-base)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '0 5px',
                        minWidth: 16,
                        height: 16,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      {group.sessions.length}
                    </span>
                  </button>

                  {/* Session rows — each is a sortable item */}
                  {!isCollapsed &&
                    group.sessions.map((s) => (
                      <SortableSessionRow
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
