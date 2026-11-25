import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppConfig, ClientToServerEvents, ProfileSettings, ProfilesState, ServerToClientEvents } from '@argus/shared';
import { useProfiles } from '../../hooks/useProfiles.js';
import { useTheme } from '../../context/theme-context.js';
import { offerUndo } from '../../utils/undoable.js';
import {
  activeProfile, classifyFirstLaunch, configPatch, currentSettings, makeProfile, profileCardToShow,
  sameSettings, themeOf, uniqueName, type ProfileCard,
} from './profileModel.js';
import type { ProfileSheetMode } from './ProfileSheet.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Options {
  socket: TypedSocket;
  config: AppConfig | null;
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  reloadConfig: () => Promise<void>;
  /** When this window last edited config itself (useConfig().localEditAt). */
  configEditAt: number;
  /** The first-run card and the upgrade profile come from the main window only. */
  isMainWindow: boolean;
  /** Another first-run surface (the intro) is up or due; the card waits for it. */
  introPending: boolean;
}

interface OpenSheet {
  mode: ProfileSheetMode;
  fromUpgrade?: boolean;
  /** Setup only: what Cancel restores. */
  restore?: { state: ProfilesState; settings: ProfileSettings; firstRun: boolean };
}

/** How long after the last change the active profile is rewritten. */
const SYNC_DELAY_MS = 500;

/**
 * Everything profiles do at the app level: switching (apply a profile's values
 * to config and theme), keeping the active profile in step with later changes
 * made anywhere, the guided setup with a real Cancel, delete with Undo, and the
 * one-time upgrade profile for people who used Argus before profiles.
 */
export function useProfileController({ socket, config, updateConfig, reloadConfig, configEditAt, isMainWindow, introPending }: Options) {
  const { mode, setMode, palette, setPalette, localEditAt: themeEditAt } = useTheme();
  const profiles = useProfiles(socket, () => { void reloadConfig(); });
  const { state, suggestedName, save, update } = profiles;
  const [sheet, setSheet] = useState<OpenSheet | null>(null);

  // While a profile is being applied, config and theme pass through mixed
  // states; the sync below must not write those into the profile.
  const applying = useRef(0);
  // Local edits up to this time are already in the profile (or were made by
  // apply itself, i.e. ARE the profile) and must not be written back.
  const syncedAt = useRef(0);
  const apply = useCallback(async (settings: ProfileSettings) => {
    applying.current++;
    try {
      const t = themeOf(settings);
      if (t.mode) setMode(t.mode);
      if (t.palette) setPalette(t.palette);
      const patch = configPatch(settings);
      if (Object.keys(patch).length > 0) await updateConfig(patch);
    } finally {
      applying.current--;
      syncedAt.current = Date.now() + 1;
    }
  }, [setMode, setPalette, updateConfig]);

  // Keep the active profile equal to what is on screen, after a change made in
  // THIS window. Its config is then fresh (a local updateConfig returns the
  // full merged config); another window's copy may be stale, and must never
  // write it back over a newer profile.
  const active = activeProfile(state);
  const editAt = Math.max(configEditAt, themeEditAt);
  useEffect(() => {
    if (!config || !active || applying.current > 0 || editAt <= syncedAt.current) return;
    const now = currentSettings(config, mode, palette);
    // Nothing to write: this edit is accounted for. Otherwise a later
    // profile change from another window would look like a local edit here.
    if (sameSettings(now, active.settings)) { syncedAt.current = editAt; return; }
    const id = active.id;
    const t = setTimeout(() => {
      if (applying.current > 0) return;
      syncedAt.current = editAt;
      void update((s) => ({ ...s, profiles: s.profiles.map((p) => (p.id === id ? { ...p, settings: now } : p)) }));
    }, SYNC_DELAY_MS);
    return () => clearTimeout(t);
  }, [config, mode, palette, active, update, editAt]);

  // Someone who used Argus before profiles: their current setup becomes their
  // first profile, and a one-time notice says so.
  // A new user is marked `welcome` right away (persisted), before the intro can
  // stamp introSeen and make them look like an existing one.
  const classified = useRef(false);
  useEffect(() => {
    if (!isMainWindow || classified.current) return;
    const who = classifyFirstLaunch(state, config);
    if (!who || !config || !state) return;
    classified.current = true;
    if (who === 'new') { void save({ ...state, prompt: 'welcome' }); return; }
    const p = makeProfile(suggestedName || 'My profile', currentSettings(config, mode, palette), Date.now());
    void save({ activeId: p.id, profiles: [p], prompt: 'upgrade' });
  }, [isMainWindow, state, config, suggestedName, mode, palette, save]);

  /** Start a guided setup on a fresh profile (a copy of what is on screen now). */
  const startSetup = useCallback((firstRun: boolean) => {
    if (!state || !config) return;
    const settings = currentSettings(config, mode, palette);
    const taken = state.profiles.map((p) => p.name);
    const name = firstRun && state.profiles.length === 0 ? (suggestedName || 'My profile') : uniqueName('Profile', [...taken, 'Profile']);
    const p = makeProfile(name, settings, Date.now());
    const restore = { state, settings, firstRun };
    void save({ ...state, activeId: p.id, profiles: [...state.profiles, p] });
    setSheet({ mode: 'setup', restore });
  }, [state, config, mode, palette, suggestedName, save]);

  const switchTo = useCallback(async (id: string) => {
    const target = state?.profiles.find((p) => p.id === id);
    if (!state || !target) return;
    // Config first, then the switch: another window reloads config when it sees
    // the new activeId, and must find the new values already there.
    await apply(target.settings);
    await save({ ...state, activeId: id });
  }, [state, save, apply]);

  const cancelSetup = useCallback(async () => {
    const r = sheet?.restore;
    setSheet(null);
    if (!r) return;
    const prompt = r.firstRun && (r.state.prompt === 'pending' || r.state.prompt === 'welcome') ? 'later' : r.state.prompt;
    await apply(r.settings);
    await save({ ...r.state, prompt });
  }, [sheet, save, apply]);

  const finish = useCallback(() => {
    const wasSetup = sheet?.mode === 'setup';
    setSheet(null);
    if (wasSetup || state?.prompt !== 'done') void update((s) => ({ ...s, prompt: 'done' }));
  }, [sheet, state?.prompt, update]);

  const setIdentity = useCallback((patch: { name?: string; avatar?: string }) => {
    const id = state?.activeId;
    if (!id) return;
    void update((s) => ({ ...s, profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }, [state?.activeId, update]);

  const remove = useCallback(async () => {
    if (!state || !active || state.profiles.length < 2) return;
    const before = state;
    const gone = active;
    const next = state.profiles.find((p) => p.id !== gone.id)!;
    setSheet(null);
    await apply(next.settings);
    await save({ ...state, activeId: next.id, profiles: state.profiles.filter((p) => p.id !== gone.id) });
    offerUndo({
      message: `Deleted profile ${gone.name}`,
      undo: async () => {
        await apply(gone.settings);
        await save(before);
      },
    });
  }, [state, active, save, apply]);

  const card: ProfileCard = isMainWindow && !sheet ? profileCardToShow(state, introPending) : null;

  return {
    state,
    active,
    card,
    sheet,
    onCardOpen: () => {
      if (card === 'welcome') startSetup(true);
      else { void update((s) => ({ ...s, prompt: 'done' })); setSheet({ mode: 'edit', fromUpgrade: true }); }
    },
    onCardLater: () => { void update((s) => ({ ...s, prompt: card === 'welcome' ? 'later' : 'done' })); },
    onSetup: () => startSetup(true),
    onNew: () => startSetup(false),
    onEdit: () => setSheet({ mode: 'edit' }),
    onSwitch: (id: string) => { void switchTo(id); },
    onCancel: () => { void cancelSetup(); },
    onDone: finish,
    onIdentity: setIdentity,
    onDelete: state && state.profiles.length > 1 ? () => { void remove(); } : undefined,
  };
}
