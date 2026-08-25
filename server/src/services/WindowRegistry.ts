import { randomUUID } from 'crypto';
import { MAIN_WINDOW_ID, type ArgusWindow, type WindowRegistryState } from '@argus/shared';
import type { WindowStore } from '../persistence/WindowStore.js';

/** 'Window N' where N is one past the highest existing numeric label (main is window 1). */
function nextLabel(windows: ArgusWindow[]): string {
  const nums = windows
    .map((w) => /^Window (\d+)$/.exec(w.label)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return `Window ${Math.max(1, ...nums) + 1}`;
}

/**
 * Source of truth for windows + session→window assignments. All mutations
 * persist through the store and notify listeners with a fresh snapshot
 * (index.ts wires listeners to the socket broadcast).
 */
export class WindowRegistry {
  private state: WindowRegistryState = { windows: [], assignments: {} };
  private listeners: Array<(s: WindowRegistryState) => void> = [];

  constructor(private store: WindowStore) {}

  async init(): Promise<void> {
    this.state = await this.store.load(); // store guarantees main exists
  }

  getState(): WindowRegistryState {
    return {
      windows: this.state.windows.map((w) => ({ ...w })),
      assignments: { ...this.state.assignments },
    };
  }

  onChange(cb: (s: WindowRegistryState) => void): void {
    this.listeners.push(cb);
  }

  ownerOf(sessionId: string): string {
    return this.state.assignments[sessionId] ?? MAIN_WINDOW_ID;
  }

  private async commit(): Promise<void> {
    await this.store.save(this.state);
    const snap = this.getState();
    for (const cb of this.listeners) cb(snap);
  }

  async createWindow(sessionId?: string): Promise<ArgusWindow> {
    const win: ArgusWindow = {
      id: randomUUID(),
      label: nextLabel(this.state.windows),
      isMain: false,
      createdAt: Date.now(),
    };
    this.state.windows.push(win);
    if (sessionId) this.state.assignments[sessionId] = win.id;
    await this.commit();
    return win;
  }

  async deleteWindow(id: string): Promise<boolean> {
    if (id === MAIN_WINDOW_ID) return false;
    if (!this.state.windows.some((w) => w.id === id)) return false;
    this.state.windows = this.state.windows.filter((w) => w.id !== id);
    // Its sessions fall back to main (default assignment = absent entry).
    for (const [sid, wid] of Object.entries(this.state.assignments)) {
      if (wid === id) delete this.state.assignments[sid];
    }
    await this.commit();
    return true;
  }

  async assign(sessionId: string, windowId: string): Promise<boolean> {
    if (!this.state.windows.some((w) => w.id === windowId)) return false;
    if (windowId === MAIN_WINDOW_ID) delete this.state.assignments[sessionId];
    else this.state.assignments[sessionId] = windowId;
    await this.commit();
    return true;
  }

  async mergeAll(targetId: string, allSessionIds: string[]): Promise<string[] | null> {
    if (!this.state.windows.some((w) => w.id === targetId)) return null;
    this.state.assignments = {};
    if (targetId !== MAIN_WINDOW_ID) {
      for (const sid of allSessionIds) this.state.assignments[sid] = targetId;
    }
    const removed = this.state.windows
      .filter((w) => !w.isMain && w.id !== targetId)
      .map((w) => w.id);
    this.state.windows = this.state.windows.filter((w) => w.isMain || w.id === targetId);
    await this.commit();
    return removed;
  }

  async removeSession(sessionId: string): Promise<void> {
    if (sessionId in this.state.assignments) {
      delete this.state.assignments[sessionId];
      await this.commit();
    }
  }

  async pruneToSessions(validIds: Set<string>): Promise<void> {
    let changed = false;
    for (const sid of Object.keys(this.state.assignments)) {
      if (!validIds.has(sid)) {
        delete this.state.assignments[sid];
        changed = true;
      }
    }
    if (changed) await this.commit();
  }
}
