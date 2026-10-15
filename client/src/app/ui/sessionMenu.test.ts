import { describe, it, expect, vi } from 'vitest';
import type { SessionInfo } from '@argus/shared';
import { buildSessionMenuItems, type SessionMenuActions } from './sessionMenu.js';

const session: SessionInfo = {
  id: 's1',
  name: 'argus',
  folderPath: '/tmp/argus',
  status: 'idle',
  createdAt: '2026-01-01T00:00:00.000Z',
  agentType: 'claude',
  flags: [],
};

function actions(over: Partial<SessionMenuActions> = {}): SessionMenuActions {
  return {
    onRename: vi.fn(),
    onOpen: vi.fn(),
    onKill: vi.fn(),
    onRestart: vi.fn(),
    ...over,
  };
}

/** Ids of the clickable entries, in order (headers/separators dropped). */
const ids = (entries: ReturnType<typeof buildSessionMenuItems>) =>
  entries.filter((e) => 'id' in e).map((e) => (e as { id: string }).id);

describe('buildSessionMenuItems', () => {
  it('always offers rename, and it sits in the Session group above restart', () => {
    const order = ids(buildSessionMenuItems(session, actions()));
    expect(order).toContain('rename');
    expect(order.indexOf('rename')).toBeLessThan(order.indexOf('restart'));
  });

  it('rename fires with the session it was built for', () => {
    const a = actions();
    const item = buildSessionMenuItems(session, a).find((e) => 'id' in e && e.id === 'rename');
    (item as { onClick: () => void }).onClick();
    expect(a.onRename).toHaveBeenCalledWith(session);
  });

  it('omits minimize on surfaces that cannot minimize', () => {
    expect(ids(buildSessionMenuItems(session, actions()))).not.toContain('minimize');
    expect(ids(buildSessionMenuItems(session, actions({ onToggleMinimize: vi.fn() })))).toContain('minimize');
  });

  it('gates apply/mark-done per session, not just on the handler being wired', () => {
    const withHandlers = actions({ onMerge: vi.fn(), onMarkDone: vi.fn() });
    expect(ids(buildSessionMenuItems(session, withHandlers))).not.toContain('apply');
    expect(ids(buildSessionMenuItems(session, withHandlers))).not.toContain('done');

    const allowed = ids(buildSessionMenuItems(session, { ...withHandlers, canMerge: () => true, canMarkDone: () => true }));
    expect(allowed).toContain('apply');
    expect(allowed).toContain('done');

    // The gate sees the session, so one shell can offer apply while another cannot.
    const worktreeOnly = { ...withHandlers, canMerge: (s: SessionInfo) => !!s.worktreePath };
    expect(ids(buildSessionMenuItems(session, worktreeOnly))).not.toContain('apply');
    expect(ids(buildSessionMenuItems({ ...session, worktreePath: '/tmp/wt' }, worktreeOnly))).toContain('apply');
  });

  it('shows diagnostics only when debug tools are on', () => {
    const dump = vi.fn();
    expect(ids(buildSessionMenuItems(session, actions({ onDumpDiagnostics: dump })))).not.toContain('diag');
    expect(ids(buildSessionMenuItems(session, actions({ onDumpDiagnostics: dump, showDiagnostics: true })))).toContain('diag');
  });

  it('disables diff when neither diff handler is wired', () => {
    const diff = buildSessionMenuItems(session, actions()).find((e) => 'id' in e && e.id === 'diff');
    expect((diff as { disabled?: boolean }).disabled).toBe(true);
  });

  it('flags a dirty session in the diff label', () => {
    const dirty = buildSessionMenuItems({ ...session, hasGitChanges: true }, actions({ onFocusDiff: vi.fn() }));
    const diff = dirty.find((e) => 'id' in e && e.id === 'diff') as { label: string };
    expect(diff.label).toMatch(/has changes/);
  });

  it('keeps close last and marked as danger', () => {
    const entries = buildSessionMenuItems(session, actions());
    const order = ids(entries);
    expect(order.at(-1)).toBe('close');
    const close = entries.find((e) => 'id' in e && e.id === 'close') as { danger?: boolean };
    expect(close.danger).toBe(true);
  });

  it('offers Resume conversation only where canResume says so, right above restart', () => {
    const onResume = vi.fn();
    const none = ids(buildSessionMenuItems(session, actions({ onResume, canResume: () => false })));
    expect(none).not.toContain('resume');
    const items = buildSessionMenuItems(session, actions({ onResume, canResume: () => true }));
    const order = ids(items);
    expect(order.indexOf('resume')).toBe(order.indexOf('restart') - 1);
    (items.find((e) => 'id' in e && e.id === 'resume') as { onClick: () => void }).onClick();
    expect(onResume).toHaveBeenCalledWith(session);
  });

  it('offers Finish… (beta F8) only with a handler and only for a worktree shell', () => {
    const wt: SessionInfo = { ...session, worktreePath: '/wt', worktreeBranch: 'feat/x' };
    const canFinish = (s: SessionInfo) => !!s.worktreePath && !!s.worktreeBranch;
    // Flag off ⇒ ArgusApp passes no handler ⇒ no entry.
    expect(ids(buildSessionMenuItems(wt, actions({ canFinish })))).not.toContain('finish');
    expect(ids(buildSessionMenuItems(session, actions({ onFinish: vi.fn(), canFinish })))).not.toContain('finish');
    const onFinish = vi.fn();
    const item = buildSessionMenuItems(wt, actions({ onFinish, canFinish })).find((e) => 'id' in e && e.id === 'finish');
    expect(item).toBeTruthy();
    (item as { onClick: () => void }).onClick();
    expect(onFinish).toHaveBeenCalledWith(wt);
  });

  it('offers Hand off… (beta F12) only when a handler is passed', () => {
    // Flag off ⇒ ArgusApp passes no handler ⇒ no entry.
    expect(ids(buildSessionMenuItems(session, actions()))).not.toContain('handoff');
    const onHandoff = vi.fn();
    const item = buildSessionMenuItems(session, actions({ onHandoff })).find((e) => 'id' in e && e.id === 'handoff');
    expect(item).toBeTruthy();
    (item as { onClick: () => void }).onClick();
    expect(onHandoff).toHaveBeenCalledWith(session);
  });

  it('offers Chain to… (beta F13) only when a handler is passed, and not for an exited shell', () => {
    expect(ids(buildSessionMenuItems(session, actions()))).not.toContain('chain');
    const onChain = vi.fn();
    const item = buildSessionMenuItems(session, actions({ onChain })).find((e) => 'id' in e && e.id === 'chain');
    expect(item).toBeTruthy();
    (item as { onClick: () => void }).onClick();
    expect(onChain).toHaveBeenCalledWith(session);
    expect(ids(buildSessionMenuItems({ ...session, status: 'exited' }, actions({ onChain })))).not.toContain('chain');
  });
});
