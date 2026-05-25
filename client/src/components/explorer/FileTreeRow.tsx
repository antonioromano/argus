import { ChevronRight, ChevronDown } from 'lucide-react';
import type { VirtualRow } from '../../hooks/useVirtualTree.js';
import type { GitFileStatusCode } from '@argus/shared';
import { FileTypeIcon } from './FileTypeIcon.js';

interface FileTreeRowProps {
  row: VirtualRow;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleExpand: (path: string) => Promise<void>;
}

/**
 * Colored pill badge showing a single-letter git status code.
 * Ignored files ('!!') are represented with 'I' to keep the badge meaningful.
 */
function GitBadge({ status }: { status: GitFileStatusCode }) {
  const color =
    status === '?'  ? 'var(--color-success, #10b981)' :
    status === 'D'  ? 'var(--color-error, #ef4444)'   :
    status === '!!' ? 'var(--color-text-muted)'        :
                     'var(--color-warning, #f59e0b)';

  const label = status === '!!' ? 'I' : status;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        borderRadius: '3px',
        fontSize: '9px',
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        background: color,
        marginLeft: '4px',
      }}
    >
      {label}
    </span>
  );
}

/**
 * A single 22px row in the virtualized file tree.
 *
 * Layout (left → right):
 *   [expand chevron or spacer] [FileTypeIcon] [filename] [git badge]
 *
 * Indentation is driven by `row.depth` at 16px per level plus an 8px left gutter.
 */
export function FileTreeRow({
  row,
  isSelected,
  onClick,
  onContextMenu,
  onToggleExpand,
}: FileTreeRowProps) {
  const isDir = !row.entry.isFile;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        height: '22px',
        minHeight: '22px',
        paddingLeft: `${row.depth * 16 + 8}px`,
        paddingRight: '8px',
        cursor: 'pointer',
        background: isSelected
          ? 'var(--color-selection-bg, rgba(255,255,255,0.08))'
          : 'transparent',
        userSelect: 'none',
        fontSize: '12px',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-filepath={row.entry.path}
    >
      {/* Expand / collapse chevron for directories; fixed-width spacer for files */}
      {isDir ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            void onToggleExpand(row.entry.path);
          }}
          style={{
            width: '14px',
            height: '14px',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            color: 'var(--color-text-muted)',
          }}
        >
          {row.isExpanded
            ? <ChevronDown size={12} />
            : <ChevronRight size={12} />}
        </span>
      ) : (
        <span style={{ width: '14px', flexShrink: 0 }} />
      )}

      {/* Language / type icon */}
      <FileTypeIcon
        ext={row.entry.ext}
        name={row.entry.name}
        isDir={isDir}
        isOpen={row.isExpanded}
      />

      {/* Filename — flex: 1 so it absorbs all remaining horizontal space */}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--color-text)',
        }}
      >
        {row.entry.name}
      </span>

      {/* Git status badge — shown for any non-ignored status */}
      {row.effectiveBadge && row.effectiveBadge !== '!!' && (
        <GitBadge status={row.effectiveBadge} />
      )}
    </div>
  );
}
