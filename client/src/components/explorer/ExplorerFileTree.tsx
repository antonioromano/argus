import { useState } from 'react';
import { FilePlus, FolderPlus, Pencil, ExternalLink, Trash2 } from 'lucide-react';
import type { GitFileStatusCode } from '@argus/shared';
import type { UseFileTreeResult, VisibleNode } from '../../hooks/useFileTree.js';
import { api } from '../../services/api.js';
import { AlertSheet, ContextMenu } from '../primitives/index.js';
import { toastError } from '../../errors/toastError.js';
import type { ContextMenuEntry } from '../primitives/index.js';
import { FileTreeView } from './FileTreeView.js';

interface ExplorerFileTreeProps {
  tree: UseFileTreeResult;
  sessionId: string;
  gitStatuses: Map<string, GitFileStatusCode>;
  selectedPath: string | null;
  /** Single-click a file → open as a preview (reused, italic) tab. */
  onOpenFile: (path: string) => void;
  /** Double-click a file → pin it as a permanent tab. */
  onActivateFile?: (path: string) => void;
}

interface MenuState {
  node: VisibleNode | null;
  x: number;
  y: number;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? p : p.slice(0, i);
}

export function ExplorerFileTree({ tree, sessionId, gitStatuses, selectedPath, onOpenFile, onActivateFile }: ExplorerFileTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Only for an item the staged trash can't take (another volume): its delete
  // is permanent, so it is confirmed first. Everything else deletes with Undo.
  const [pendingDelete, setPendingDelete] = useState<VisibleNode | null>(null);
  const remove = (node: VisibleNode) => {
    void tree.removePath(node.path, !node.entry.isFile).then((r) => {
      if (r === 'needs-permanent') setPendingDelete(node);
    });
  };

  const buildItems = (node: VisibleNode | null): ContextMenuEntry[] => {
    // Where new items are created: inside a folder, alongside a file, or at root.
    const targetDir = node ? (node.entry.isFile ? dirOf(node.path) : node.path) : tree.rootPath;

    const items: ContextMenuEntry[] = [
      { id: 'new-file', label: 'New File', icon: FilePlus, onClick: () => tree.beginCreate(targetDir, false) },
      { id: 'new-folder', label: 'New Folder', icon: FolderPlus, onClick: () => tree.beginCreate(targetDir, true) },
    ];

    if (node) {
      items.push(
        { separator: true },
        { id: 'rename', label: 'Rename', icon: Pencil, shortcut: '↵', onClick: () => tree.beginRename(node.path, node.entry.name) },
        {
          id: 'reveal',
          label: 'Reveal in Finder',
          icon: ExternalLink,
          onClick: () => { void api.openPath(sessionId, node.path, true).catch((e: unknown) => toastError(e, 'Couldn’t reveal it in Finder')); },
        },
        { separator: true },
        { id: 'delete', label: 'Delete', icon: Trash2, shortcut: '⌫', danger: true, onClick: () => remove(node) },
      );
    }
    return items;
  };

  const deleteName = pendingDelete?.entry.name ?? '';
  const deleteIsDir = pendingDelete ? !pendingDelete.entry.isFile : false;

  return (
    <>
      <FileTreeView
        nodes={tree.visibleNodes}
        selectedPath={selectedPath}
        gitStatuses={gitStatuses}
        onSelect={(node) => {
          if (node.draft) return;
          if (node.entry.isFile) onOpenFile(node.path);
          else tree.toggle(node.path);
        }}
        onActivate={(node) => {
          if (node.entry.isFile) onActivateFile?.(node.path);
        }}
        edit={tree.edit}
        onSubmitEdit={(name) => void tree.submitEdit(name)}
        onCancelEdit={tree.cancelEdit}
        onContextMenu={(node, x, y) => setMenu({ node, x, y })}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}

      <AlertSheet
        isOpen={!!pendingDelete}
        title={`Delete ${deleteName}?`}
        message={
          deleteIsDir
            ? 'This folder is on another volume, so it can’t go to the Argus trash. Deleting it removes everything inside it for good. This cannot be undone.'
            : 'This file is on another volume, so it can’t go to the Argus trash. Deleting it cannot be undone.'
        }
        confirmLabel="Delete"
        confirmDestructive
        onConfirm={() => {
          if (pendingDelete) void tree.removePath(pendingDelete.path, deleteIsDir, { permanent: true });
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
