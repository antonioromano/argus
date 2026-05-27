import { useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Terminal, Copy, GitCompare, FolderOpen, LayoutGrid, PowerOff } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { ChipStrip } from '../ui/ChipStrip.js';
import { ReplyBar } from '../ui/ReplyBar.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, DirtyBadge, Button, IconButton } from '../../components/primitives/index.js';
import { DiffSidePanel } from '../panels/DiffSidePanel.js';
import { ExplorerSidePanel } from '../panels/ExplorerSidePanel.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import type { SidePanel } from '../types.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface FocusProps {
  sessions: SessionInfo[];
  active: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  sidePanel: SidePanel;
  onSelect: (id: string) => void;
  onBack: () => void;
  onToggleDiff: () => void;
  onToggleExplorer: () => void;
  onExpandDiff: () => void;
  onExpandExplorer: () => void;
  onClone: () => void;
  onKill: () => void;
}

export function Focus({
  sessions,
  active,
  socket,
  theme,
  sidePanel,
  onSelect,
  onBack,
  onToggleDiff,
  onToggleExplorer,
  onExpandDiff,
  onExpandExplorer,
  onClone,
  onKill,
}: FocusProps) {
  const [copied, setCopied] = useState(false);
  const sendInput = (data: string) => {
    socket.emit('session:input', { sessionId: active.id, data });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ChipStrip sessions={sessions} activeId={active.id} onSelect={onSelect} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-3)',
              padding: 'var(--s-1) var(--s-4)',
              background: 'var(--bg-1)',
              borderBottom: '1px solid var(--line-2)',
              flexShrink: 0,
            }}
          >
            <AgentGlyph agent={active.agentType} size={16} />
            <span
              onClick={() => {
                void navigator.clipboard.writeText(active.folderPath);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              title="Click to copy path"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-sm)',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                color: copied ? 'var(--accent)' : 'var(--fg-0)',
                minWidth: 0,
              }}
            >
              {copied ? 'Copied path' : active.folderPath}
            </span>

            <StatusPill status={active.status} />
            {active.hasGitChanges && <DirtyBadge onClick={onExpandDiff} />}
            <div style={{ flex: 1 }} />
            <Button
              variant={sidePanel?.kind === 'diff' ? 'solid' : 'ghost'}
              size="sm"
              icon={GitCompare}
              onClick={onToggleDiff}
            >
              Diff
            </Button>
            <Button
              variant={sidePanel?.kind === 'explorer' ? 'solid' : 'ghost'}
              size="sm"
              icon={FolderOpen}
              onClick={onToggleExplorer}
            >
              Files
            </Button>
            <Button variant="ghost" icon={Copy} size="sm" onClick={onClone}>Clone</Button>
            <IconButton icon={LayoutGrid} label="Exit focus" size="sm" onClick={onBack} />
            <IconButton icon={PowerOff} label="Close session" size="sm" onClick={onKill} />
            <span hidden><Terminal /></span>
          </div>

          <div style={{ flex: 1, minHeight: 0, display: 'flex', paddingRight: 'var(--s-3)' }}>
            <ErrorBoundary key={active.id} label={active.name}>
              <TerminalShell session={active} socket={socket} theme={theme} status={active.status} />
            </ErrorBoundary>
          </div>

          <ReplyBar session={active} onSend={sendInput} />
        </div>

        {sidePanel?.kind === 'diff' && sidePanel.sessionId === active.id && (
          <DiffSidePanel
            session={active}
            onExpand={onExpandDiff}
            onCommit={onExpandDiff}
          />
        )}
        {sidePanel?.kind === 'explorer' && sidePanel.sessionId === active.id && (
          <ExplorerSidePanel session={active} onExpand={onExpandExplorer} />
        )}
      </div>
    </div>
  );
}
