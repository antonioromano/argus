import { useSyncExternalStore } from 'react';
import { isFullScreenSuppressed, subscribeFullScreenSuppression } from './nativeOverlayRegistry.js';

/** Whether a full-screen sheet or modal is currently open (see nativeOverlayRegistry). */
export function useFullScreenSuppressed(): boolean {
  return useSyncExternalStore(subscribeFullScreenSuppression, isFullScreenSuppressed, () => false);
}
