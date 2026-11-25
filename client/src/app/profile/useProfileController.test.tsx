import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig, type ProfilesState } from '@argus/shared';
import { ThemeContext, type ThemeContextValue } from '../../context/theme-context.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined }

const server = vi.hoisted(() => ({ state: null as unknown as ProfilesState, saves: [] as ProfilesState[] }));
vi.mock('../../services/api.js', () => ({
  api: {
    getProfiles: async () => ({ ...structuredClone(server.state), suggestedName: 'Ada Lovelace' }),
    saveProfiles: async (s: ProfilesState) => { server.state = structuredClone(s); server.saves.push(structuredClone(s)); return structuredClone(s); },
  },
}));
const undo = vi.hoisted(() => ({ last: null as null | { message: string; undo: () => Promise<void> | void } }));
vi.mock('../../utils/undoable.js', () => ({ offerUndo: (o: { message: string; undo: () => void }) => { undo.last = o; return { dismiss() {} }; } }));

import { useProfileController } from './useProfileController.js';

const handlers = new Map<string, () => void>();
const socket = { on: (e: string, fn: () => void) => { handlers.set(e, fn); }, off: vi.fn() } as never;
/** Another writer changed profiles.json: fire the broadcast the hook listens to. */
const serverChanged = async () => { await act(async () => { handlers.get('profiles:changed')?.(); }); await flush(); };
let container: HTMLDivElement;
let root: Root;
const out = { ctl: null as unknown as ReturnType<typeof useProfileController> };
let config: AppConfig;
const theme = { mode: 'dark' as ThemeContextValue['mode'], palette: 'argus' as ThemeContextValue['palette'], editAt: 0 };
const edits = { config: 0 };
const updateConfig = vi.fn(async (patch: Partial<AppConfig>) => { config = { ...config, ...patch }; edits.config = Date.now() + Math.random(); rerender(); return config; });

function Harness({ isMainWindow = true }: { isMainWindow?: boolean }) {
  // eslint-disable-next-line react-hooks/immutability -- test harness: exposes the hook's return to the assertions
  out.ctl = useProfileController({ socket, config, updateConfig, reloadConfig: async () => {}, configEditAt: edits.config, isMainWindow, introPending: false });
  return null;
}
function rerender() {
  const value: ThemeContextValue = {
    theme: theme.mode === 'light' ? 'light' : 'dark', isDark: theme.mode !== 'light', mode: theme.mode,
    setMode: (m) => { theme.mode = m; theme.editAt = Date.now() + Math.random(); rerender(); }, toggle: () => {},
    palette: theme.palette, setPalette: (p) => { theme.palette = p; theme.editAt = Date.now() + Math.random(); rerender(); },
    localEditAt: theme.editAt,
  };
  root.render(<ThemeContext.Provider value={value}><Harness /></ThemeContext.Provider>);
}
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  config = structuredClone(DEFAULT_CONFIG);
  theme.mode = 'dark'; theme.palette = 'argus'; theme.editAt = 0; edits.config = 0;
  server.saves = []; undo.last = null; updateConfig.mockClear();
  server.state = { activeId: null, profiles: [], prompt: 'pending' };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
  act(() => rerender());
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('useProfileController', () => {
  it('welcomes a new user; setup creates the first profile from the current look', async () => {
    await flush();
    expect(server.state.prompt).toBe('welcome');
    expect(out.ctl.card).toBe('welcome');
    await act(async () => { out.ctl.onCardOpen(); });
    await flush();
    expect(out.ctl.sheet?.mode).toBe('setup');
    expect(server.state.profiles).toHaveLength(1);
    expect(server.state.profiles[0].name).toBe('Ada Lovelace');
    expect(server.state.profiles[0].settings.themeMode).toBe('dark');
    act(() => out.ctl.onDone());
    await flush();
    expect(server.state.prompt).toBe('done');
  });

  it('a new user stays new after the intro stamps introSeen (no upgrade card)', async () => {
    await flush();
    act(() => { config = { ...config, introSeen: 'release-0.30', quickActionPromptedAt: '0.35.0' }; rerender(); });
    await flush();
    expect(server.state.prompt).toBe('welcome');
    expect(server.state.profiles).toHaveLength(0);
    expect(out.ctl.card).toBe('welcome');
  });

  it('a no-op local edit does not let a later remote profile change be written back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.state = { activeId: 'a', prompt: 'done', profiles: [{ id: 'a', name: 'Home', avatar: '', createdAt: 1, settings: { ...((await import('./profileModel.js')).currentSettings(config, 'dark', 'argus')) } }] };
    await serverChanged();
    // A local edit outside the profile's keys: nothing to write.
    await act(async () => { await updateConfig({ ptyBackend: 'tmux' } as Partial<AppConfig>); });
    await act(async () => { vi.advanceTimersByTime(600); });
    // Another window changes the profile; this window's config is not refreshed.
    server.state = { ...server.state, profiles: [{ ...server.state.profiles[0], settings: { ...server.state.profiles[0].settings, density: 'compact' } }] };
    await serverChanged();
    await act(async () => { vi.advanceTimersByTime(600); });
    await flush();
    expect(server.state.profiles[0].settings.density).toBe('compact');
    vi.useRealTimers();
  });

  it('cancel drops the new profile and puts the look back', async () => {
    await act(async () => { out.ctl.onSetup(); });
    await flush();
    await act(async () => { await updateConfig({ density: 'compact' }); });
    act(() => { theme.palette = 'github'; rerender(); });
    await act(async () => { out.ctl.onCancel(); });
    await flush();
    expect(server.state.profiles).toHaveLength(0);
    expect(server.state.prompt).toBe('later');
    expect(config.density).toBe('default');
    expect(theme.palette).toBe('argus');
  });

  it('switching applies the target profile to config and theme', async () => {
    server.state = {
      activeId: 'a', prompt: 'done',
      profiles: [
        { id: 'a', name: 'Home', avatar: '', createdAt: 1, settings: { density: 'default', themeMode: 'dark', colorTheme: 'argus' } },
        { id: 'b', name: 'Work', avatar: '', createdAt: 1, settings: { density: 'compact', themeMode: 'light', colorTheme: 'github' } },
      ],
    };
    await serverChanged();
    await act(async () => { out.ctl.onSwitch('b'); });
    await flush();
    expect(server.state.activeId).toBe('b');
    expect(config.density).toBe('compact');
    expect({ mode: theme.mode, palette: theme.palette }).toEqual({ mode: 'light', palette: 'github' });
  });

  it('writes later changes back into the active profile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.state = { activeId: 'a', prompt: 'done', profiles: [{ id: 'a', name: 'Home', avatar: '', createdAt: 1, settings: {} }] };
    await serverChanged();
    await act(async () => { await updateConfig({ codeFontSize: 15 }); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await flush();
    expect(server.state.profiles[0].settings.codeFontSize).toBe(15);
    vi.useRealTimers();
  });

  it('never writes back a change it did not make (another window\'s, or a reload)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.state = { activeId: 'a', prompt: 'done', profiles: [{ id: 'a', name: 'Home', avatar: '', createdAt: 1, settings: { codeFontSize: 17 } }] };
    await serverChanged();
    // A stale local copy re-rendered without any local edit.
    act(() => { config = { ...config, codeFontSize: 13 }; rerender(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await flush();
    expect(server.state.profiles[0].settings.codeFontSize).toBe(17);
    vi.useRealTimers();
  });

  it('turns an existing user\'s setup into an upgrade profile, once', async () => {
    act(() => root.unmount());
    config = { ...structuredClone(DEFAULT_CONFIG), introSeen: 'release-0.30', density: 'compact' };
    server.state = { activeId: null, profiles: [], prompt: 'pending' };
    act(() => { root = createRoot(container); rerender(); });
    await flush(); await flush();
    expect(server.state.prompt).toBe('upgrade');
    expect(server.state.profiles[0].settings.density).toBe('compact');
    expect(out.ctl.card).toBe('upgrade');
  });

  it('deletes with an Undo that restores the profile', async () => {
    server.state = {
      activeId: 'a', prompt: 'done',
      profiles: [
        { id: 'a', name: 'Home', avatar: '', createdAt: 1, settings: { density: 'default' } },
        { id: 'b', name: 'Work', avatar: '', createdAt: 1, settings: { density: 'compact' } },
      ],
    };
    await serverChanged();
    await act(async () => { out.ctl.onDelete!(); });
    await flush();
    expect(server.state.profiles.map((p) => p.id)).toEqual(['b']);
    expect(config.density).toBe('compact');
    expect(undo.last?.message).toBe('Deleted profile Home');
    await act(async () => { await undo.last!.undo(); });
    await flush();
    expect(server.state.profiles.map((p) => p.id)).toEqual(['a', 'b']);
    expect(server.state.activeId).toBe('a');
  });
});
