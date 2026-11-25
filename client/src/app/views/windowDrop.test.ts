import { describe, it, expect } from 'vitest';
import type { ClientRect, DroppableContainer } from '@dnd-kit/core';
import { parseWindowDrop, tileCollision } from './windowDrop.js';

const rect = (left: number, top: number, width: number, height: number): ClientRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

// Shelf across the top (y 0–64), two tiles below it.
const rects = new Map<string, ClientRect>([
  ['window-drop:new', rect(0, 0, 180, 64)],
  ['window-drop:w2', rect(190, 0, 300, 64)],
  ['tile-a', rect(0, 0, 500, 400)],
  ['tile-b', rect(500, 0, 500, 400)],
]);
const containers = [...rects.keys()].map((id) => ({ id }) as unknown as DroppableContainer);

function collide(pointer: { x: number; y: number } | null, dragged = rect(400, 300, 200, 40)) {
  return tileCollision({
    active: { id: 'tile-a' } as never,
    collisionRect: dragged,
    droppableRects: rects as never,
    droppableContainers: containers,
    pointerCoordinates: pointer,
  }).map((c) => c.id);
}

describe('parseWindowDrop', () => {
  it('reads the new-window target', () => {
    expect(parseWindowDrop('window-drop:new')).toEqual({ kind: 'new' });
  });
  it('reads a window target', () => {
    expect(parseWindowDrop('window-drop:abc-123')).toEqual({ kind: 'window', windowId: 'abc-123' });
  });
  it('is null for a tile id or nothing', () => {
    expect(parseWindowDrop('3f1c-uuid')).toBeNull();
    expect(parseWindowDrop(null)).toBeNull();
    expect(parseWindowDrop(undefined)).toBeNull();
  });
});

describe('tileCollision', () => {
  it('picks the shelf target the pointer is inside', () => {
    expect(collide({ x: 300, y: 30 })[0]).toBe('window-drop:w2');
    expect(collide({ x: 50, y: 30 })[0]).toBe('window-drop:new');
  });

  it('falls back to the nearest tile outside the shelf, never a shelf target', () => {
    const ids = collide({ x: 700, y: 300 }, rect(600, 280, 200, 40));
    expect(ids[0]).toBe('tile-b');
    expect(ids.some((id) => String(id).startsWith('window-drop:'))).toBe(false);
  });

  it('only reorders on a keyboard drag (no pointer)', () => {
    const ids = collide(null, rect(10, 10, 100, 40));
    expect(ids.some((id) => String(id).startsWith('window-drop:'))).toBe(false);
    expect(ids[0]).toBe('tile-a');
  });
});
