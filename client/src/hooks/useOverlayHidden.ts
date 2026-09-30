import { useCallback, useSyncExternalStore } from 'react';
import { isOverlayHidden, subscribeOverlayHidden } from './nativeOverlayRegistry.js';

/** Whether this session's native terminal overlay is currently hidden by any
 *  suppression (full-screen sheet, popover, launch card). A hidden overlay
 *  leaves its tile blank, so the tile shows a placeholder meanwhile. */
export function useOverlayHidden(sessionId: string): boolean {
  const get = useCallback(() => isOverlayHidden(sessionId), [sessionId]);
  return useSyncExternalStore(subscribeOverlayHidden, get, () => false);
}
