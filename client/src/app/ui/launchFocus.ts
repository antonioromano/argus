/**
 * File → Review Pending Launch moves focus into the pending-launch stack. The
 * stack (LaunchCardStack, one per window) registers its element here; the menu
 * handler map calls focusPendingLaunch. Kept out of the component file so it
 * stays a components-only module (fast refresh).
 */
let mountedStack: HTMLElement | null = null;

/** Register the mounted stack element; returns the matching unregister. */
export function registerLaunchStack(el: HTMLElement | null): () => void {
  mountedStack = el;
  return () => { if (mountedStack === el) mountedStack = null; };
}

/** Focus the newest pending launch's first control, if a stack is showing one. */
export function focusPendingLaunch(): void {
  mountedStack?.querySelector<HTMLElement>('[data-testid="launch-prompt"], [data-testid="launch-card"] button')?.focus();
}
