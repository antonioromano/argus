import { useState, useEffect, useCallback } from 'react';
import type { ChangelistStateResponse } from '@argus/shared';
import { api } from '../services/api.js';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const DEFAULT_STATE: ChangelistStateResponse = {
  version: 1,
  activeId: 'default',
  lists: [{ id: 'default', name: 'Changes', isDefault: true, fileKeys: [] }],
};

export interface UseChangelistsResult {
  state: ChangelistStateResponse;
  loading: boolean;
  setActiveChangelist: (id: string) => void;
  createChangelist: (name: string) => void;
  renameChangelist: (id: string, name: string) => void;
  deleteChangelist: (id: string) => void;
  moveFileToChangelist: (fileKey: string, targetListId: string) => void;
  addFileToChangelist: (fileKey: string, listId: string) => void;
  removeFileFromChangelist: (fileKey: string, listId: string) => void;
  reconcileWithStatus: (activeFileKeys: Set<string>) => void;
}

export function useChangelists(sessionId: string): UseChangelistsResult {
  const [state, setState] = useState<ChangelistStateResponse>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);

  // Load on mount
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api.getChangelists(sessionId).then(loaded => {
      setState(loaded);
    }).catch(() => {
      setState({ ...DEFAULT_STATE, lists: [{ ...DEFAULT_STATE.lists[0] }] });
    }).finally(() => setLoading(false));
  }, [sessionId]);

  // Persist state changes to the server
  const saveRef = useCallback((newState: ChangelistStateResponse) => {
    api.saveChangelists(sessionId, newState).catch(console.error);
  }, [sessionId]);

  const updateState = useCallback((updater: (prev: ChangelistStateResponse) => ChangelistStateResponse) => {
    setState(prev => {
      const next = updater(prev);
      saveRef(next);
      return next;
    });
  }, [saveRef]);

  const setActiveChangelist = useCallback((id: string) => {
    updateState(prev => ({ ...prev, activeId: id }));
  }, [updateState]);

  const createChangelist = useCallback((name: string) => {
    const id = generateId();
    updateState(prev => ({
      ...prev,
      lists: [...prev.lists, { id, name, isDefault: false, fileKeys: [] }],
      activeId: id,
    }));
  }, [updateState]);

  const renameChangelist = useCallback((id: string, name: string) => {
    updateState(prev => ({
      ...prev,
      lists: prev.lists.map(l => l.id === id ? { ...l, name } : l),
    }));
  }, [updateState]);

  const deleteChangelist = useCallback((id: string) => {
    updateState(prev => {
      const target = prev.lists.find(l => l.id === id);
      if (!target || target.isDefault) return prev;
      const defaultList = prev.lists.find(l => l.isDefault)!;
      const merged = [...defaultList.fileKeys, ...target.fileKeys.filter(k => !defaultList.fileKeys.includes(k))];
      const newLists = prev.lists
        .filter(l => l.id !== id)
        .map(l => l.isDefault ? { ...l, fileKeys: merged } : l);
      return {
        ...prev,
        lists: newLists,
        activeId: prev.activeId === id ? (prev.lists.find(l => l.isDefault)?.id ?? 'default') : prev.activeId,
      };
    });
  }, [updateState]);

  const moveFileToChangelist = useCallback((fileKey: string, targetListId: string) => {
    updateState(prev => ({
      ...prev,
      lists: prev.lists.map(l => {
        if (l.id === targetListId) {
          return { ...l, fileKeys: l.fileKeys.includes(fileKey) ? l.fileKeys : [...l.fileKeys, fileKey] };
        }
        return { ...l, fileKeys: l.fileKeys.filter(k => k !== fileKey) };
      }),
    }));
  }, [updateState]);

  const addFileToChangelist = useCallback((fileKey: string, listId: string) => {
    updateState(prev => ({
      ...prev,
      lists: prev.lists.map(l =>
        l.id === listId
          ? { ...l, fileKeys: l.fileKeys.includes(fileKey) ? l.fileKeys : [...l.fileKeys, fileKey] }
          : l
      ),
    }));
  }, [updateState]);

  const removeFileFromChangelist = useCallback((fileKey: string, listId: string) => {
    updateState(prev => ({
      ...prev,
      lists: prev.lists.map(l =>
        l.id === listId
          ? { ...l, fileKeys: l.fileKeys.filter(k => k !== fileKey) }
          : l
      ),
    }));
  }, [updateState]);

  // Remove file keys that are no longer in the active changed files set
  const reconcileWithStatus = useCallback((activeFileKeys: Set<string>) => {
    updateState(prev => ({
      ...prev,
      lists: prev.lists.map(l => ({
        ...l,
        fileKeys: l.fileKeys.filter(k => activeFileKeys.has(k)),
      })),
    }));
  }, [updateState]);

  return {
    state,
    loading,
    setActiveChangelist,
    createChangelist,
    renameChangelist,
    deleteChangelist,
    moveFileToChangelist,
    addFileToChangelist,
    removeFileFromChangelist,
    reconcileWithStatus,
  };
}
