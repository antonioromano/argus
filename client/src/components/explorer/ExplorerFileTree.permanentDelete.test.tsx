import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UseFileTreeResult, VisibleNode } from '../../hooks/useFileTree.js';

// Explorer Delete on an item the staged trash can't take (another volume,
// EXDEV → 409 needsPermanent): the only delete that asks first. An AlertSheet
// says it can't be undone; confirming retries with permanent: true, Cancel
// deletes nothing. A normal delete opens no sheet (it gets an Undo toast).

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// The virtualised view needs layout; a row that opens the context menu is enough here.
vi.mock('./FileTreeView.js', () => ({
  FileTreeView: ({ nodes, onContextMenu }: { nodes: VisibleNode[]; onContextMenu: (n: VisibleNode, x: number, y: number) => void }) => (
    <div>
      {nodes.map((n) => (
        <button key={n.path} data-testid={`row-${n.entry.name}`} onClick={() => onContextMenu(n, 10, 10)}>{n.entry.name}</button>
      ))}
    </div>
  ),
}));

import { ExplorerFileTree } from './ExplorerFileTree.js';

const node = (name: string, isFile: boolean): VisibleNode => ({
  path: `/repo/${name}`, depth: 0, expanded: false, loading: false,
  entry: { name, isFile } as VisibleNode['entry'],
});
const FILE = node('big.bin', true);
const DIR = node('assets', false);

let container: HTMLDivElement;
let root: Root;

function makeTree(removePath: UseFileTreeResult['removePath']): UseFileTreeResult {
  return {
    rootPath: '/repo', visibleNodes: [FILE, DIR], toggle: vi.fn(), refresh: vi.fn(), isLoading: false,
    rootError: null, rootLoaded: true, edit: null, beginCreate: vi.fn(), beginRename: vi.fn(), cancelEdit: vi.fn(),
    submitEdit: vi.fn(async () => true), removePath,
  };
}

function render(tree: UseFileTreeResult) {
  act(() => {
    root.render(<ExplorerFileTree tree={tree} sessionId="s1" gitStatuses={new Map()} selectedPath={null} onOpenFile={vi.fn()} />);
  });
}

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const sheet = () => document.querySelector('[role="alertdialog"]');
const buttonIn = (el: ParentNode | null, label: string) =>
  [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

async function deleteRow(name: string) {
  act(() => { (container.querySelector(`[data-testid="row-${name}"]`) as HTMLButtonElement).click(); });
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes('Delete')) as HTMLElement;
  expect(item).toBeTruthy();
  act(() => { item.click(); });
  await flush();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExplorerFileTree permanent-delete fallback', () => {
  it('a staged delete opens no sheet', async () => {
    const removePath = vi.fn(async () => 'deleted' as const);
    render(makeTree(removePath));
    await deleteRow('big.bin');
    expect(removePath).toHaveBeenCalledWith('/repo/big.bin', false);
    expect(sheet()).toBeNull();
  });

  it('needs-permanent asks first; confirming deletes for good', async () => {
    const removePath = vi.fn<UseFileTreeResult['removePath']>()
      .mockResolvedValueOnce('needs-permanent')
      .mockResolvedValueOnce('deleted');
    render(makeTree(removePath));
    await deleteRow('big.bin');

    expect(sheet()?.textContent).toContain('Delete big.bin?');
    expect(sheet()?.textContent).toContain('another volume');
    expect(sheet()?.textContent).toContain('cannot be undone');
    expect(removePath).toHaveBeenCalledTimes(1);

    act(() => { buttonIn(sheet(), 'Delete')!.click(); });
    await flush();
    expect(removePath).toHaveBeenLastCalledWith('/repo/big.bin', false, { permanent: true });
    expect(sheet()).toBeNull();
  });

  it('a folder says everything inside goes too, and is retried as a folder', async () => {
    const removePath = vi.fn<UseFileTreeResult['removePath']>()
      .mockResolvedValueOnce('needs-permanent')
      .mockResolvedValueOnce('deleted');
    render(makeTree(removePath));
    await deleteRow('assets');
    expect(sheet()?.textContent).toContain('removes everything inside it');
    act(() => { buttonIn(sheet(), 'Delete')!.click(); });
    await flush();
    expect(removePath).toHaveBeenLastCalledWith('/repo/assets', true, { permanent: true });
  });

  it('Cancel deletes nothing', async () => {
    const removePath = vi.fn<UseFileTreeResult['removePath']>().mockResolvedValueOnce('needs-permanent');
    render(makeTree(removePath));
    await deleteRow('big.bin');
    act(() => { buttonIn(sheet(), 'Cancel')!.click(); });
    await flush();
    expect(removePath).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
  });
});
