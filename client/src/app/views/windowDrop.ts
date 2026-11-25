/** Drop-target ids and collision for the Mosaic's "Move to" shelf (WindowDropShelf). */
import { pointerWithin, closestCenter, type CollisionDetection, type UniqueIdentifier } from '@dnd-kit/core';

/** A window a dragged tile can be dropped on (every window but this one). */
export interface WindowDropTarget {
  id: string;
  label: string;
  /** Sessions that window owns now. */
  sessionCount: number;
}

// Session ids are UUIDs, so this prefix can never collide with a tile's own id.
const PREFIX = 'window-drop:';
export const NEW_WINDOW_DROP_ID = `${PREFIX}new`;
export const windowDropId = (windowId: string) => `${PREFIX}${windowId}`;

export type WindowDrop = { kind: 'new' } | { kind: 'window'; windowId: string };

/** What a drop on `id` means, or null when `id` is a tile, not a shelf target. */
export function parseWindowDrop(id: UniqueIdentifier | null | undefined): WindowDrop | null {
  if (typeof id !== 'string' || !id.startsWith(PREFIX)) return null;
  if (id === NEW_WINDOW_DROP_ID) return { kind: 'new' };
  return { kind: 'window', windowId: id.slice(PREFIX.length) };
}

const isShelfId = (id: UniqueIdentifier) => parseWindowDrop(id) !== null;

/**
 * Shelf targets win only while the pointer is inside one; everywhere else the
 * grid keeps today's closestCenter among tiles. closestCenter alone would let a
 * target steal the drop from a top-row tile just because its centre is nearer.
 * A keyboard drag has no pointer, so it can only ever reorder.
 */
export const tileCollision: CollisionDetection = (args) => {
  const shelf = args.droppableContainers.filter((c) => isShelfId(c.id));
  if (shelf.length > 0 && args.pointerCoordinates) {
    const hit = pointerWithin({ ...args, droppableContainers: shelf });
    if (hit.length > 0) return hit;
  }
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => !isShelfId(c.id)) });
};
