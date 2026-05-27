import type { SessionInfo } from '@argus/shared';
import { X, FolderOpen, RefreshCw } from 'lucide-react';
import { IconButton, EmptyState } from '../../components/primitives/index.js';

interface ExplorerOverlayProps {
  session: SessionInfo;
  onClose: () => void;
}

/**
 * Full-screen file explorer overlay. Placeholder shell — file tree + editor
 * implementation deferred. Header + chrome match design.
 */
export function ExplorerOverlay({ session, onClose }: ExplorerOverlayProps) {
  return (
    <div
      style={{
        width: '92vw',
        height: '88vh',
        maxWidth: 1400,
        background: 'var(--bg-0)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-4)',
        boxShadow: 'var(--shadow-sheet)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-3) var(--s-4)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <FolderOpen size={14} strokeWidth={1.6} color="var(--accent)" />
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>ARGUS · EXPLORER</div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-1)' }}>
          {session.folderPath}
        </span>
        <div style={{ flex: 1 }} />
        <IconButton icon={RefreshCw} label="Refresh" size="sm" />
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside
          style={{
            width: 280,
            flexShrink: 0,
            background: 'var(--bg-1)',
            borderRight: '1px solid var(--line-2)',
            display: 'flex',
            flexDirection: 'column',
            padding: 'var(--s-4)',
          }}
        >
          <EmptyState
            icon={FolderOpen}
            title="File tree"
            hint="Full virtual tree pending implementation."
          />
        </aside>

        <main style={{ flex: 1, minWidth: 0, background: 'var(--bg-inset)' }}>
          <EmptyState
            icon={FolderOpen}
            title="No file selected"
            hint="Pick a file from the tree to preview."
          />
        </main>
      </div>
    </div>
  );
}
