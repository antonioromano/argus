import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFileTree, type UseFileTreeResult } from './useFileTree.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Explorer delete through the staged trash (plan 004 U7): no confirm, Undo
// (10 s) restores; an item on another volume asks the caller to confirm.

vi.mock('../services/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api.js')>()),
  api: { getDirectoryChildren: vi.fn(async () => ({ entries: [] })), deleteFile: vi.fn(), restoreFile: vi.fn(), createFile: vi.fn(), renameFile: vi.fn() },
}));
vi.mock('../components/primitives/Toast.js', () => ({ pushToast: vi.fn() }));
const offers = vi.hoisted(() => [] as { message: string; durationMs?: number; undo: () => Promise<void> }[]);
vi.mock('../utils/undoable.js', async (orig) => ({
  ...(await orig<typeof import('../utils/undoable.js')>()),
  offerUndo: (o: (typeof offers)[number]) => { offers.push(o); return { dismiss() {} }; },
}));
const fakeSocket = { on: vi.fn(), off: vi.fn() };
vi.mock('./useSocket.js', () => ({ useSocket: () => fakeSocket }));

import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/Toast.js';

let container: HTMLDivElement;
let root: Root;
const probe: { tree?: UseFileTreeResult } = {};
let seq = 0;
let sessionId = '';
function Probe() {
  const tree = useFileTree('/repo', sessionId);
  useLayoutEffect(() => { probe.tree = tree; });
  return null;
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  sessionId = `rm${++seq}`;
  offers.length = 0;
  vi.mocked(api.deleteFile).mockReset();
  vi.mocked(api.restoreFile).mockReset().mockResolvedValue({ success: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); root.render(<Probe />); });
  await flush();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('removePath', () => {
  it('stages the delete and offers a 10 s Undo that restores and refreshes the folder', async () => {
    vi.mocked(api.deleteFile).mockResolvedValue({ success: true, undoId: 'u1' });
    let r: string | undefined;
    await act(async () => { r = await probe.tree!.removePath('/repo/a.ts', false); });
    expect(r).toBe('deleted');
    expect(api.deleteFile).toHaveBeenCalledWith(sessionId, '/repo/a.ts', undefined);
    expect(offers[0]).toMatchObject({ message: 'Deleted a.ts', durationMs: 10_000 });

    vi.mocked(api.getDirectoryChildren).mockClear();
    await act(async () => { await offers[0].undo(); });
    expect(api.restoreFile).toHaveBeenCalledWith(sessionId, 'u1');
    expect(api.getDirectoryChildren).toHaveBeenCalledWith('/repo', true);
  });

  it('an item on another volume asks for a permanent delete and offers nothing yet', async () => {
    vi.mocked(api.deleteFile).mockResolvedValueOnce({ success: false, needsPermanent: true, error: 'another volume' });
    let r: string | undefined;
    await act(async () => { r = await probe.tree!.removePath('/repo/big', true); });
    expect(r).toBe('needs-permanent');
    expect(offers).toHaveLength(0);

    vi.mocked(api.deleteFile).mockResolvedValueOnce({ success: true });
    await act(async () => { r = await probe.tree!.removePath('/repo/big', true, { permanent: true }); });
    expect(r).toBe('deleted');
    expect(api.deleteFile).toHaveBeenLastCalledWith(sessionId, '/repo/big', true);
    expect(offers).toHaveLength(0);
  });

  it('a failed restore rejects, so the Undo helper reports it', async () => {
    vi.mocked(api.deleteFile).mockResolvedValue({ success: true, undoId: 'u2' });
    vi.mocked(api.restoreFile).mockRejectedValue(new Error('Something new already exists at a.ts'));
    await act(async () => { await probe.tree!.removePath('/repo/a.ts', false); });
    await expect(offers[0].undo()).rejects.toThrow('already exists');
  });
});

// V6 / V8: create and rename report failures under the open input, and a
// success shows only as the new row (no toast).
describe('inline create / rename', () => {
  it('a failed create keeps the input open with the reason, and no toast', async () => {
    vi.mocked(pushToast).mockClear();
    vi.mocked(api.createFile).mockResolvedValue({ success: false, error: 'file or directory already exists' });
    act(() => probe.tree!.beginCreate('/repo', false));
    let ok: boolean | undefined;
    await act(async () => { ok = await probe.tree!.submitEdit('a.ts'); });
    expect(ok).toBe(false);
    expect(probe.tree!.edit?.error).toBe('Couldn’t create a.ts: file or directory already exists');
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('a successful rename closes the input without a toast', async () => {
    vi.mocked(pushToast).mockClear();
    vi.mocked(api.renameFile).mockResolvedValue({ success: true });
    act(() => probe.tree!.beginRename('/repo/a.ts', 'a.ts'));
    await act(async () => { await probe.tree!.submitEdit('b.ts'); });
    expect(probe.tree!.edit).toBeNull();
    expect(api.renameFile).toHaveBeenCalledWith(sessionId, '/repo/a.ts', '/repo/b.ts');
    expect(pushToast).not.toHaveBeenCalled();
  });
});
