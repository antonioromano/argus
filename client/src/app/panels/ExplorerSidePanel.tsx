import type { SessionInfo } from '@argus/shared';
import { FolderOpen, Maximize2, RefreshCw } from 'lucide-react';
import { IconButton, Tooltip } from '../../components/primitives/index.js';
import { useFileTree } from '../../hooks/useFileTree.js';
import { useGitFileStatuses } from '../../hooks/useGitFileStatuses.js';
import { FileTreeView } from '../../components/explorer/FileTreeView.js';

interface ExplorerSidePanelProps {
  session: SessionInfo;
  onExpand: (filePath?: string) => void;
  width?: number;
}

export function ExplorerSidePanel({ session, onExpand, width = 320 }: ExplorerSidePanelProps) {
  const tree = useFileTree(session.folderPath);
  const gitStatuses = useGitFileStatuses({ sessionId: session.id, enabled: true });
  const folderName = session.folderPath.split('/').filter(Boolean).pop() ?? session.folderPath;

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-1) var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <FolderOpen size={13} strokeWidth={1.6} color="var(--accent)" />
        <Tooltip content={session.folderPath}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              color: 'var(--fg-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {folderName}
          </span>
        </Tooltip>
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={tree.refresh} />
        <IconButton icon={Maximize2} label="Expand" size="sm" onClick={() => onExpand()} />
      </div>
      <FileTreeView
        nodes={tree.visibleNodes}
        selectedPath={null}
        gitStatuses={gitStatuses}
        onSelect={(node) => {
          if (node.entry.isFile) {
            onExpand(node.path);
          } else {
            tree.toggle(node.path);
          }
        }}
      />
    </aside>
  );
}
