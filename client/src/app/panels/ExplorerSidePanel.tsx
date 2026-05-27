import type { SessionInfo } from '@argus/shared';
import { FolderOpen, Maximize2, RefreshCw } from 'lucide-react';
import { IconButton, EmptyState } from '../../components/primitives/index.js';

interface ExplorerSidePanelProps {
  session: SessionInfo;
  onExpand: () => void;
}

/**
 * Compact file tree placeholder. Full virtual tree lives in ExplorerOverlay.
 * This panel shows root folder name + an "Expand" CTA to open full explorer.
 */
export function ExplorerSidePanel({ session, onExpand }: ExplorerSidePanelProps) {
  const folderName = session.folderPath.split('/').filter(Boolean).pop() ?? session.folderPath;
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-3) var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
        }}
      >
        <FolderOpen size={13} strokeWidth={1.6} color="var(--accent)" />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-sm)',
            color: 'var(--fg-1)',
          }}
        >
          {folderName}
        </span>
        <div style={{ flex: 1 }} />
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={() => {}} />
        <IconButton icon={Maximize2} label="Expand" size="sm" onClick={onExpand} />
      </div>
      <div style={{ flex: 1, padding: 'var(--s-4)' }}>
        <EmptyState
          icon={FolderOpen}
          title="Open full explorer"
          hint="Click expand to browse files, search, edit."
        />
      </div>
    </aside>
  );
}
