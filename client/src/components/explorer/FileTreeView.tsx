import { useEffect, useRef, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronRight,
  ChevronDown,
  File,
  FileText,
  FileCode,
  FileJson,
  Folder,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GitFileStatusCode } from '@argus/shared';
import type { VisibleNode, TreeEdit } from '../../hooks/useFileTree.js';
import { Tooltip } from '../primitives/index.js';

const ROW_HEIGHT = 22;
const INDENT_PX = 12;

interface FileTreeViewProps {
  nodes: VisibleNode[];
  selectedPath: string | null;
  gitStatuses: Map<string, GitFileStatusCode>;
  onSelect: (node: VisibleNode) => void;
  edit?: TreeEdit | null;
  onSubmitEdit?: (name: string) => void;
  onCancelEdit?: () => void;
  onContextMenu?: (node: VisibleNode | null, x: number, y: number) => void;
}

export function FileTreeView({
  nodes,
  selectedPath,
  gitStatuses,
  onSelect,
  edit = null,
  onSubmitEdit,
  onCancelEdit,
  onContextMenu,
}: FileTreeViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className="argus-scroll"
      onContextMenu={(e) => {
        // Empty-area right-click (rows stop propagation) → target the root.
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu(null, e.clientX, e.clientY);
      }}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        background: 'var(--bg-1)',
      }}
    >
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const node = nodes[vRow.index];
          const selected = selectedPath === node.path;
          const isRenaming = edit?.kind === 'rename' && edit.path === node.path;
          const rowStyle: CSSProperties = {
            position: 'absolute',
            top: vRow.start,
            left: 0,
            right: 0,
            height: ROW_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: 8 + node.depth * INDENT_PX,
            paddingRight: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
          };

          if (node.draft || isRenaming) {
            return (
              <div key={node.path} role="row" style={{ ...rowStyle, background: 'var(--accent-bg)', borderLeft: '2px solid var(--accent)' }}>
                <ChevronCell node={node} />
                <IconCell node={node} />
                <EditRowInput
                  isDir={!node.entry.isFile}
                  initial={isRenaming && edit?.kind === 'rename' ? edit.currentName : ''}
                  onSubmit={(name) => onSubmitEdit?.(name)}
                  onCancel={() => onCancelEdit?.()}
                />
              </div>
            );
          }

          return (
            <div
              key={node.path}
              role="row"
              tabIndex={-1}
              onClick={() => onSelect(node)}
              onContextMenu={(e) => {
                if (!onContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(node, e.clientX, e.clientY);
              }}
              style={{
                ...rowStyle,
                color: selected ? 'var(--accent)' : 'var(--fg-1)',
                background: selected ? 'var(--bg-3)' : 'transparent',
                borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <ChevronCell node={node} />
              <IconCell node={node} />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {node.entry.name}
              </span>
              <StatusDot status={gitStatuses.get(node.path)} />
            </div>
          );
        })}
      </div>
      {nodes.length === 0 && (
        <div style={{ padding: 'var(--s-4)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)' }}>
          Empty folder
        </div>
      )}
    </div>
  );
}

function EditRowInput({
  isDir,
  initial,
  onSubmit,
  onCancel,
}: {
  isDir: boolean;
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the stem (name without extension) for renames; whole value otherwise.
    const dot = initial.lastIndexOf('.');
    if (initial && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial]);

  return (
    <input
      ref={ref}
      defaultValue={initial}
      placeholder={isDir ? 'folder name…' : 'filename.ext…'}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          committed.current = true;
          onSubmit((e.target as HTMLInputElement).value);
        } else if (e.key === 'Escape') {
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!committed.current) onCancel();
      }}
      style={{
        all: 'unset',
        flex: 1,
        minWidth: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        color: 'var(--fg-0)',
        caretColor: 'var(--accent)',
      }}
    />
  );
}

function ChevronCell({ node }: { node: VisibleNode }) {
  if (node.entry.isFile) return <span style={{ width: 12, flexShrink: 0 }} />;
  if (node.loading) {
    return (
      <Loader2
        size={12}
        strokeWidth={1.6}
        color="var(--fg-3)"
        style={{ flexShrink: 0, animation: 'argus-spin 0.9s linear infinite' }}
      />
    );
  }
  const Icon = node.expanded ? ChevronDown : ChevronRight;
  return <Icon size={12} strokeWidth={1.8} color="var(--fg-3)" style={{ flexShrink: 0 }} />;
}

function IconCell({ node }: { node: VisibleNode }) {
  if (!node.entry.isFile) {
    const Icon = node.expanded ? FolderOpen : Folder;
    return <Icon size={12} strokeWidth={1.6} color="var(--accent)" style={{ flexShrink: 0 }} />;
  }
  const Icon = fileIcon(node.entry.ext);
  return <Icon size={12} strokeWidth={1.6} color="var(--fg-3)" style={{ flexShrink: 0 }} />;
}

function fileIcon(ext: string): LucideIcon {
  switch (ext) {
    case '.md':
    case '.mdx':
    case '.txt':
      return FileText;
    case '.json':
    case '.jsonc':
      return FileJson;
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.py':
    case '.rb':
    case '.go':
    case '.rs':
    case '.java':
    case '.c':
    case '.cpp':
    case '.h':
    case '.hpp':
    case '.cs':
    case '.php':
    case '.swift':
    case '.kt':
    case '.sh':
    case '.sql':
    case '.css':
    case '.scss':
    case '.html':
      return FileCode;
    default:
      return File;
  }
}

function StatusDot({ status }: { status?: GitFileStatusCode }) {
  if (!status) return null;
  const color = STATUS_COLOR[status];
  return (
    <Tooltip content={STATUS_LABEL[status]}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          marginLeft: 4,
        }}
      />
    </Tooltip>
  );
}

const STATUS_COLOR: Record<GitFileStatusCode, string> = {
  M: 'var(--dirty)',
  A: 'var(--ok)',
  D: 'var(--danger)',
  R: 'var(--accent)',
  C: 'var(--accent)',
  '?': 'var(--fg-4)',
  '!!': 'var(--fg-4)',
};

const STATUS_LABEL: Record<GitFileStatusCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  '?': 'Untracked',
  '!!': 'Ignored',
};
