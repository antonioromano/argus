import { MAIN_WINDOW_ID } from '@argus/shared';

/** Which Argus window this renderer is. Electron loads each window with
 *  ?windowId=<id>; dev:web and /mobile carry no param and act as main. */
export function parseWindowId(search: string): string {
  const id = new URLSearchParams(search).get('windowId');
  return id || MAIN_WINDOW_ID;
}

export const myWindowId: string =
  typeof window !== 'undefined' ? parseWindowId(window.location.search) : MAIN_WINDOW_ID;
