import { useState, useRef } from 'react';
import type { SessionInfo, SessionGroup, FavoriteEntryMeta } from '@argus/shared';
import { FAVORITES_GROUP_ID } from '@argus/shared';
import { ChevronRight, Plus, Trash2, CircleX, Check, X, Eye, EyeOff, Star, RotateCcw } from 'lucide-react';
import { StatusDot, Tooltip } from '../../components/primitives/index.js';
import { AgentGlyph } from './AgentGlyph.js';
import { GROUP_COLORS, resolveGroupColor } from '../../constants/groupColors.js';
import type { GroupedSessions, GhostFavorite } from '../../hooks/useGroups.js';
import { shellLabel } from '../../utils/sessionLabel.js';

const OTHERS = '__others__';

// Amber star color (matches the 'amber' group color key)
const STAR_COLOR_DARK = '#FFB454';
const STAR_COLOR_LIGHT = '#B26A00';

interface SessionTreeProps {
  grouped: GroupedSessions;
  activeGroupId: string | null;
  isDark: boolean;
  onAssign: (sessionId: string, groupId: string | null) => void;
  onToggleCollapsed: (id: string) => void;
  onFilterGroup: (id: string | null) => void;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onSetColor: (id: string, color: string) => void;
  onSetOthersColor: (color: string) => void;
  onDeleteGroup: (id: string) => void;
  onKillGroup: (group: SessionGroup) => void;
  onKillOthers: () => void;
  onOpenSession: (id: string) => void;
  onToggleFavorite: (session: SessionInfo) => void;
  onSpawnFromFavorite: (session: SessionInfo | null, meta?: FavoriteEntryMeta, ghostId?: string) => void;
  isFavorite: (sessionId: string) => boolean;
  onToggleFavoritesCollapsed: () => void;
  othersFolderName?: string;
}

export function SessionTree({
  grouped, activeGroupId, isDark,
  onAssign, onToggleCollapsed, onFilterGroup, onCreateGroup,
  onRenameGroup, onSetColor, onSetOthersColor, onDeleteGroup, onKillGroup, onKillOthers,
  onOpenSession, onToggleFavorite, onSpawnFromFavorite, isFavorite, onToggleFavoritesCollapsed,
  othersFolderName = 'Others',
}: SessionTreeProps) {
  const dragId = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [othersCollapsed, setOthersCollapsed] = useState(false);

  const handleDrop = (groupId: string | null) => {
    if (dragId.current) onAssign(dragId.current, groupId);
    dragId.current = null;
    setDropTarget(null);
  };

  const starColor = isDark ? STAR_COLOR_DARK : STAR_COLOR_LIGHT;

  return (
    <div style={{ margin: '2px 0 var(--s-2)' }}>
      {/* Favourites section — pinned at top, shown only when non-empty */}
      {grouped.favorites && (
        <FavoritesNode
          favorites={grouped.favorites}
          dropping={dropTarget === FAVORITES_GROUP_ID}
          starColor={starColor}
          onDragOverGroup={() => setDropTarget(FAVORITES_GROUP_ID)}
          onDragLeaveGroup={() => setDropTarget((t) => (t === FAVORITES_GROUP_ID ? null : t))}
          onDrop={() => handleDrop(FAVORITES_GROUP_ID)}
          onDragStartLeaf={(id) => { dragId.current = id; }}
          onChevron={onToggleFavoritesCollapsed}
          onOpenSession={onOpenSession}
          onSpawnFromFavorite={onSpawnFromFavorite}
          onToggleFavorite={onToggleFavorite}
          isFavorite={isFavorite}
        />
      )}

      {grouped.groups.map(({ group, sessions }) => (
        <GroupNode
          key={group.id}
          group={group}
          sessions={sessions}
          active={activeGroupId === group.id}
          dropping={dropTarget === group.id}
          isDark={isDark}
          starColor={starColor}
          onDragOverGroup={() => setDropTarget(group.id)}
          onDragLeaveGroup={() => setDropTarget((t) => (t === group.id ? null : t))}
          onDrop={() => handleDrop(group.id)}
          onDragStartLeaf={(id) => { dragId.current = id; }}
          onChevron={() => onToggleCollapsed(group.id)}
          onFilter={() => onFilterGroup(activeGroupId === group.id ? null : group.id)}
          onRename={(name) => onRenameGroup(group.id, name)}
          onSetColor={(c) => onSetColor(group.id, c)}
          onDelete={() => onDeleteGroup(group.id)}
          onKill={() => onKillGroup(group)}
          onOpenSession={onOpenSession}
          onToggleFavorite={onToggleFavorite}
          isFavorite={isFavorite}
        />
      ))}

      {/* Others — permanent, ungrouped catch-all */}
      <OthersNode
        sessions={grouped.others}
        color={grouped.othersColor}
        isDark={isDark}
        starColor={starColor}
        collapsed={othersCollapsed}
        dropping={dropTarget === OTHERS}
        active={activeGroupId === OTHERS}
        name={othersFolderName}
        onChevron={() => setOthersCollapsed((v) => !v)}
        onSetColor={onSetOthersColor}
        onFilter={() => onFilterGroup(activeGroupId === OTHERS ? null : OTHERS)}
        onKill={onKillOthers}
        onDragOverGroup={() => setDropTarget(OTHERS)}
        onDragLeaveGroup={() => setDropTarget((t) => (t === OTHERS ? null : t))}
        onDrop={() => handleDrop(null)}
        onDragStartLeaf={(id) => { dragId.current = id; }}
        onOpenSession={onOpenSession}
        onToggleFavorite={onToggleFavorite}
        isFavorite={isFavorite}
      />

      {creating ? (
        <NameInput
          placeholder="Group name"
          onCommit={(name) => { if (name.trim()) onCreateGroup(name.trim()); setCreating(false); }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button type="button" onClick={() => setCreating(true)} style={createBtnStyle}>
          <Plus size={12} strokeWidth={1.8} />
          <span>New group</span>
        </button>
      )}
    </div>
  );
}

/* ---------- favourites node ---------- */
function FavoritesNode({
  favorites, dropping, starColor,
  onDragOverGroup, onDragLeaveGroup, onDrop, onDragStartLeaf,
  onChevron, onOpenSession, onSpawnFromFavorite, onToggleFavorite, isFavorite,
}: {
  favorites: GroupedSessions['favorites'] & object;
  dropping: boolean;
  starColor: string;
  onDragOverGroup: () => void;
  onDragLeaveGroup: () => void;
  onDrop: () => void;
  onDragStartLeaf: (id: string) => void;
  onChevron: () => void;
  onOpenSession: (id: string) => void;
  onSpawnFromFavorite: (session: SessionInfo | null, meta?: FavoriteEntryMeta, ghostId?: string) => void;
  onToggleFavorite: (session: SessionInfo) => void;
  isFavorite: (sessionId: string) => boolean;
}) {
  const [hover, setHover] = useState(false);
  const liveCount = favorites.items.filter((item): item is SessionInfo => !('ghost' in item)).length;
  const ghostCount = favorites.items.length - liveCount;
  const totalCount = liveCount + ghostCount;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOverGroup(); }}
      onDragLeave={onDragLeaveGroup}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...headStyle,
          background: dropping ? 'var(--accent-bg)' : hover ? 'var(--bg-2)' : 'transparent',
          borderLeft: `2px solid ${dropping ? 'var(--accent-edge)' : 'transparent'}`,
        }}
      >
        <Tooltip content="Collapse / expand">
          <button type="button" onClick={onChevron} style={chevBtnStyle}>
            <ChevronRight
              size={12}
              strokeWidth={2}
              style={{ transform: favorites.collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 150ms var(--ease-std)', color: 'var(--fg-3)' }}
            />
          </button>
        </Tooltip>

        <Star size={10} strokeWidth={2} fill={starColor} style={{ color: starColor, flexShrink: 0 }} />

        <span style={{ ...nameBtnStyle, cursor: 'default', color: 'var(--fg-1)' }}>Favourites</span>

        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>
          {totalCount}
        </span>
      </div>

      {!favorites.collapsed && favorites.items.map((item) => {
        if ('ghost' in item) {
          return (
            <GhostLeaf
              key={item.id}
              ghost={item}
              onSpawn={() => onSpawnFromFavorite(null, item.meta, item.id)}
            />
          );
        }
        const isExited = item.status === 'exited';
        return (
          <Leaf
            key={item.id}
            session={item}
            starColor={starColor}
            dimmed={isExited}
            isFavorite={isFavorite(item.id)}
            onDragStart={() => onDragStartLeaf(item.id)}
            onOpen={() => isExited ? onSpawnFromFavorite(item) : onOpenSession(item.id)}
            onToggleFavorite={() => onToggleFavorite(item)}
          />
        );
      })}
    </div>
  );
}

/* ---------- group node ---------- */
function GroupNode({
  group, sessions, active, dropping, isDark, starColor,
  onDragOverGroup, onDragLeaveGroup, onDrop, onDragStartLeaf,
  onChevron, onFilter, onRename, onSetColor, onDelete, onKill, onOpenSession,
  onToggleFavorite, isFavorite,
}: {
  group: SessionGroup;
  sessions: SessionInfo[];
  active: boolean;
  dropping: boolean;
  isDark: boolean;
  starColor: string;
  onDragOverGroup: () => void;
  onDragLeaveGroup: () => void;
  onDrop: () => void;
  onDragStartLeaf: (id: string) => void;
  onChevron: () => void;
  onFilter: () => void;
  onRename: (name: string) => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
  onKill: () => void;
  onOpenSession: (id: string) => void;
  onToggleFavorite: (session: SessionInfo) => void;
  isFavorite: (sessionId: string) => boolean;
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const color = resolveGroupColor(group.color, isDark);
  const waiting = sessions.filter((s) => s.status === 'waiting').length;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOverGroup(); }}
      onDragLeave={onDragLeaveGroup}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          ...headStyle,
          background: dropping ? 'var(--accent-bg)' : active ? 'var(--accent-bg)' : hover ? 'var(--bg-2)' : 'transparent',
          borderLeft: `2px solid ${active ? 'var(--accent)' : dropping ? 'var(--accent-edge)' : 'transparent'}`,
        }}
      >
        <Tooltip content="Collapse / expand">
          <button type="button" onClick={onChevron} style={chevBtnStyle}>
            <ChevronRight
              size={12}
              strokeWidth={2}
              style={{ transform: group.collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 150ms var(--ease-std)', color: 'var(--fg-3)' }}
            />
          </button>
        </Tooltip>
        <Tooltip content="Set color">
          <button
            type="button"
            onClick={() => !editing && setPicking((v) => !v)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'block' }} />
          </button>
        </Tooltip>

        {editing ? (
          <NameInput initial={group.name} onCommit={(n) => { if (n.trim()) onRename(n.trim()); setEditing(false); }} onCancel={() => setEditing(false)} inline />
        ) : (
          <Tooltip content="Rename">
            <button type="button" onClick={() => setEditing(true)} style={nameBtnStyle}>
              {group.name}
            </button>
          </Tooltip>
        )}

        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>
          {sessions.length}{waiting > 0 && <span style={{ color: 'var(--accent)' }}>{` ·${waiting}`}</span>}
        </span>

        {/* always-visible filter toggle */}
        <Tooltip content={active ? 'Clear filter' : 'Filter to this group'}>
          <button
            type="button"
            onClick={onFilter}
            style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', padding: 3, borderRadius: 4,
              color: active ? 'var(--accent)' : 'var(--fg-3)' }}
          >
            {active ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
          </button>
        </Tooltip>

        {/* hover actions — always rendered, opacity toggled so the row never reflows */}
        <span style={{ ...actionsStyle, opacity: hover && !editing ? 1 : 0, pointerEvents: hover && !editing ? 'auto' : 'none' }}>
          <Act title="Kill all in group" onClick={onKill}><CircleX size={11} strokeWidth={1.8} /></Act>
          <Act title="Delete group" onClick={onDelete}><Trash2 size={11} strokeWidth={1.8} /></Act>
        </span>
      </div>

      {picking && (
        <div style={swatchRowStyle}>
          {GROUP_COLORS.map((c) => (
            <Tooltip key={c.key} content={c.label}>
              <button
                type="button"
                onClick={() => { onSetColor(c.key); setPicking(false); }}
                style={{ all: 'unset', cursor: 'pointer', width: 14, height: 14, borderRadius: '50%',
                  background: resolveGroupColor(c.key, isDark),
                  outline: c.key === group.color ? '2px solid var(--fg-2)' : 'none', outlineOffset: 1 }}
              />
            </Tooltip>
          ))}
        </div>
      )}

      {!group.collapsed && sessions.map((s) => (
        <Leaf
          key={s.id}
          session={s}
          starColor={starColor}
          isFavorite={isFavorite(s.id)}
          onDragStart={() => onDragStartLeaf(s.id)}
          onOpen={() => onOpenSession(s.id)}
          onToggleFavorite={() => onToggleFavorite(s)}
        />
      ))}
    </div>
  );
}

/* ---------- others node ---------- */
function OthersNode({
  sessions, color, isDark, starColor, collapsed, dropping, active, name,
  onChevron, onSetColor, onDragOverGroup, onDragLeaveGroup, onDrop, onDragStartLeaf, onOpenSession,
  onFilter, onKill, onToggleFavorite, isFavorite,
}: {
  sessions: SessionInfo[];
  color: string | null;
  isDark: boolean;
  starColor: string;
  collapsed: boolean;
  dropping: boolean;
  active: boolean;
  name: string;
  onChevron: () => void;
  onSetColor: (color: string) => void;
  onDragOverGroup: () => void;
  onDragLeaveGroup: () => void;
  onDrop: () => void;
  onDragStartLeaf: (id: string) => void;
  onOpenSession: (id: string) => void;
  onFilter: () => void;
  onKill: () => void;
  onToggleFavorite: (session: SessionInfo) => void;
  isFavorite: (sessionId: string) => boolean;
}) {
  const [hover, setHover] = useState(false);
  const [picking, setPicking] = useState(false);
  const dotColor = color ? resolveGroupColor(color, isDark) : 'var(--fg-4)';
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOverGroup(); }}
      onDragLeave={onDragLeaveGroup}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ ...headStyle, background: dropping ? 'var(--accent-bg)' : active ? 'var(--accent-bg)' : hover ? 'var(--bg-2)' : 'transparent',
          borderLeft: `2px solid ${dropping ? 'var(--accent-edge)' : active ? 'var(--accent)' : 'transparent'}` }}
      >
        <Tooltip content="Collapse / expand">
          <button type="button" onClick={onChevron} style={chevBtnStyle}>
            <ChevronRight size={12} strokeWidth={2}
              style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 150ms var(--ease-std)', color: 'var(--fg-3)' }} />
          </button>
        </Tooltip>
        <Tooltip content="Set color">
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'block' }} />
          </button>
        </Tooltip>
        <span style={{ ...nameBtnStyle, cursor: 'default', color: 'var(--fg-2)' }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>{sessions.length}</span>

        {/* always-visible filter toggle */}
        <Tooltip content={active ? 'Clear filter' : 'Filter to Others'}>
          <button
            type="button"
            onClick={onFilter}
            style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', padding: 3, borderRadius: 4,
              color: active ? 'var(--accent)' : 'var(--fg-3)' }}
          >
            {active ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
          </button>
        </Tooltip>

        {/* hover-revealed kill */}
        <span style={{ ...actionsStyle, opacity: hover ? 1 : 0, pointerEvents: hover ? 'auto' : 'none' }}>
          <Act title="Kill all in Others" onClick={onKill}><CircleX size={11} strokeWidth={1.8} /></Act>
        </span>
      </div>

      {picking && (
        <div style={swatchRowStyle}>
          {GROUP_COLORS.map((c) => (
            <Tooltip key={c.key} content={c.label}>
              <button
                type="button"
                onClick={() => { onSetColor(c.key); setPicking(false); }}
                style={{ all: 'unset', cursor: 'pointer', width: 14, height: 14, borderRadius: '50%',
                  background: resolveGroupColor(c.key, isDark),
                  outline: c.key === color ? '2px solid var(--fg-2)' : 'none', outlineOffset: 1 }}
              />
            </Tooltip>
          ))}
        </div>
      )}

      {!collapsed && sessions.map((s) => (
        <Leaf
          key={s.id}
          session={s}
          starColor={starColor}
          isFavorite={isFavorite(s.id)}
          onDragStart={() => onDragStartLeaf(s.id)}
          onOpen={() => onOpenSession(s.id)}
          onToggleFavorite={() => onToggleFavorite(s)}
        />
      ))}
    </div>
  );
}

/* ---------- leaf ---------- */
function Leaf({
  session, starColor, isFavorite, dimmed = false, onDragStart, onOpen, onToggleFavorite,
}: {
  session: SessionInfo;
  starColor: string;
  isFavorite: boolean;
  dimmed?: boolean;
  onDragStart: () => void;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const [hover, setHover] = useState(false);
  const label = shellLabel(session);
  return (
    <Tooltip content={session.folderPath}>
      <div
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Open ${label}`}
        onDragStart={onDragStart}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
          padding: '4px var(--s-2) 4px 28px', borderRadius: 'var(--r-2)',
          cursor: 'grab', background: hover ? 'var(--bg-2)' : 'transparent',
          opacity: dimmed ? 0.55 : 1,
        }}
      >
        <StatusDot status={session.status} size={6} decorative />
        <AgentGlyph agent={session.agentType} size={12} />
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)',
          color: hover ? 'var(--fg-0)' : 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {/* Star toggle — fixed-width slot so label never shifts on hover */}
        <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
          <Tooltip content={isFavorite ? 'Remove from Favourites' : 'Add to Favourites'}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
              style={{
                all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 3,
                opacity: isFavorite ? 1 : hover ? 0.7 : 0,
                transition: 'opacity 120ms var(--ease-std)',
                color: isFavorite ? starColor : 'var(--fg-3)',
                pointerEvents: isFavorite || hover ? 'auto' : 'none',
              }}
            >
              <Star
                size={11}
                strokeWidth={1.8}
                fill={isFavorite ? starColor : 'none'}
                style={{ color: isFavorite ? starColor : 'var(--fg-3)' }}
              />
            </button>
          </Tooltip>
        </span>
      </div>
    </Tooltip>
  );
}

/* ---------- ghost leaf ---------- */
function GhostLeaf({ ghost, onSpawn }: { ghost: GhostFavorite; onSpawn: () => void }) {
  const [hover, setHover] = useState(false);
  const label = ghost.meta.name || ghost.meta.folderPath.split('/').pop() || ghost.meta.folderPath;
  return (
    <Tooltip content={`${ghost.meta.folderPath} — click to respawn`}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Respawn ${label}`}
        onClick={onSpawn}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSpawn(); } }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
          padding: '4px var(--s-2) 4px 28px', borderRadius: 'var(--r-2)',
          cursor: 'pointer', background: hover ? 'var(--bg-2)' : 'transparent',
          opacity: 0.45,
        }}
      >
        {/* Placeholder dot + glyph area to match Leaf layout */}
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--fg-4)', flexShrink: 0 }} />
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)',
          color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontStyle: 'italic' }}>
          {label}
        </span>
        <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', justifyContent: 'center' }}>
          <RotateCcw size={11} strokeWidth={1.8} style={{ color: 'var(--fg-3)', opacity: hover ? 1 : 0.6 }} />
        </span>
      </div>
    </Tooltip>
  );
}

/* ---------- inline name input ---------- */
function NameInput({ initial = '', placeholder, onCommit, onCancel, inline }: {
  initial?: string; placeholder?: string; onCommit: (v: string) => void; onCancel: () => void; inline?: boolean;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: inline ? 0 : '4px var(--s-2)', flex: inline ? 1 : undefined }}>
      <input
        autoFocus
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onCommit(val); if (e.key === 'Escape') onCancel(); }}
        style={{ flex: 1, minWidth: 0, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
          color: 'var(--fg-0)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', padding: '3px 6px' }}
      />
      <Act title="Save" onClick={() => onCommit(val)}><Check size={11} strokeWidth={2} /></Act>
      <Act onClick={onCancel}><X size={11} strokeWidth={2} /></Act>
    </div>
  );
}

function Act({ title, onClick, children }: { title?: string; onClick: () => void; children: React.ReactNode }) {
  const [h, setH] = useState(false);
  const btn = (
    <button
      type="button"
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', padding: 3, borderRadius: 4,
        color: h ? 'var(--fg-0)' : 'var(--fg-3)', background: h ? 'var(--bg-3)' : 'transparent' }}
    >
      {children}
    </button>
  );
  return title ? <Tooltip content={title}>{btn}</Tooltip> : btn;
}

const headStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px var(--s-2) 4px 4px', borderRadius: 'var(--r-2)',
  fontSize: 'var(--t-sm)', color: 'var(--fg-1)', minHeight: 26, boxSizing: 'border-box',
};
const chevBtnStyle: React.CSSProperties = { all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 };
const nameBtnStyle: React.CSSProperties = {
  all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0, overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-1)',
};
const actionsStyle: React.CSSProperties = { display: 'inline-flex', gap: 1, marginLeft: 2, transition: 'opacity 120ms var(--ease-std)' };
const swatchRowStyle: React.CSSProperties = { display: 'flex', gap: 6, padding: '4px var(--s-2) 6px 28px' };
const createBtnStyle: React.CSSProperties = {
  all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px var(--s-2) 5px 6px', marginTop: 2, color: 'var(--fg-3)', fontSize: 'var(--t-tiny)', borderRadius: 'var(--r-2)',
};
