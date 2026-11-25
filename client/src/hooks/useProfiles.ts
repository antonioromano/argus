import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ProfilesState, ServerToClientEvents } from '@argus/shared';
import { api } from '../services/api.js';
import { toastError } from '../errors/toastError.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ProfilesApi {
  /** null until the first GET resolves. */
  state: ProfilesState | null;
  /** The OS account's full name, to prefill a first profile. */
  suggestedName: string;
  /** Replace the whole state (optimistic; rolls back to the server copy on failure). */
  save: (next: ProfilesState) => Promise<void>;
  /** Read-modify-write against the latest state, including unsaved local edits. */
  update: (fn: (s: ProfilesState) => ProfilesState) => Promise<void>;
}

/**
 * Profiles (profiles.json), kept in step across windows: every save is
 * broadcast as `profiles:changed` and each window refetches. `onRemoteSwitch`
 * fires when a refetch shows another window switched the active profile, so the
 * caller can re-read config (config itself is not pushed across windows).
 */
export function useProfiles(socket: TypedSocket, onRemoteSwitch?: (activeId: string | null) => void): ProfilesApi {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [suggestedName, setSuggestedName] = useState('');
  const stateRef = useRef<ProfilesState | null>(null);
  const onRemoteSwitchRef = useRef(onRemoteSwitch);
  useEffect(() => { onRemoteSwitchRef.current = onRemoteSwitch; }, [onRemoteSwitch]);

  const apply = useCallback((next: ProfilesState) => { stateRef.current = next; setState(next); }, []);

  const refetch = useCallback(() => {
    api.getProfiles().then(({ suggestedName: name, ...next }) => {
      const prev = stateRef.current;
      apply(next);
      setSuggestedName(name);
      if (prev && prev.activeId !== next.activeId) onRemoteSwitchRef.current?.(next.activeId);
    }).catch(console.error);
  }, [apply]);

  useEffect(() => {
    refetch();
    socket.on('profiles:changed', refetch);
    socket.on('connect', refetch);
    return () => {
      socket.off('profiles:changed', refetch);
      socket.off('connect', refetch);
    };
  }, [socket, refetch]);

  const save = useCallback(async (next: ProfilesState) => {
    apply(next);
    try {
      apply(await api.saveProfiles(next));
    } catch (err) {
      toastError(err, 'Couldn’t save your profile');
      refetch();
    }
  }, [apply, refetch]);

  const update = useCallback(async (fn: (s: ProfilesState) => ProfilesState) => {
    const cur = stateRef.current;
    if (!cur) return;
    await save(fn(cur));
  }, [save]);

  return { state, suggestedName, save, update };
}
