/**
 * Hooks for the command palette (plan 001) and the app menu: entry points into
 * the discovery layer that work from anywhere, like `pushToast`. The mounted
 * DiscoveryHost / checklist register the real handlers; with nothing mounted
 * (a secondary window, tests) each call is a no-op.
 */
interface Handlers {
  showTip: (id: string) => void;
  resetTips: () => void;
  openChecklist: () => void;
}

const handlers: Partial<Handlers> = {};

export function registerDiscoveryCommands(h: Partial<Handlers>): () => void {
  Object.assign(handlers, h);
  return () => {
    for (const k of Object.keys(h) as (keyof Handlers)[]) {
      if (handlers[k] === h[k]) delete handlers[k];
    }
  };
}

/** Show a named tip now, past the rate limit (ids in tips.ts). */
export function showTip(id: string): void { handlers.showTip?.(id); }
/** Forget which tips were shown, so each can show once more. */
export function resetTips(): void { handlers.resetTips?.(); }
/** Open the getting-started checklist, starting it if the user never had one. */
export function openChecklist(): void { handlers.openChecklist?.(); }
