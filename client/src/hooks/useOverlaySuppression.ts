import { useEffect } from 'react';
import { suppress, type Rect } from './nativeOverlayRegistry.js';

/**
 * Hide any native terminal overlay this surface would cover. A child NSWindow
 * always paints above the parent's web content (measured: Gate A), so without
 * this a modal, palette or menu renders UNDERNEATH a native terminal.
 *
 * Pass 'all' for a full-screen dimmer, or a getter returning the surface's
 * viewport rect for a positioned popover — hiding every terminal to show a
 * tooltip would be absurd.
 *
 * Callers must actually mount/unmount for the surface's visible lifetime —
 * this hook suppresses on mount and releases on unmount, nothing more. A
 * component that stays mounted forever and merely toggles an internal
 * `isOpen` prop (e.g. AlertSheet) must gate the call behind real
 * mount/unmount (see the SuppressWhileOpen pattern in Sheet.tsx/AlertSheet.tsx),
 * not call this directly from its own top level.
 */
export function useOverlaySuppression(target: 'all' | (() => Rect | null)): void {
  useEffect(() => {
    const isAll = target === 'all';
    const rect = isAll ? null : target();
    if (!isAll && !rect) return;
    const handle = suppress(isAll ? 'all' : rect!);
    return () => handle.release();
    // Intentionally mount/unmount only: a surface's lifetime is the suppression
    // window. A moving popover re-suppressing per frame would thrash the IPC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Some floating surfaces (AlertSheet, Sheet, a Tooltip's floating bubble, a
 * dropdown built inline in a component that otherwise never unmounts) live
 * inside a component that is mounted for the app's whole lifetime and merely
 * toggles a conditionally-rendered subtree — it never itself unmounts.
 * Calling useOverlaySuppression at that component's top level would suppress
 * from first mount to app exit, not just while the surface is actually shown.
 *
 * Render this component ONLY inside the conditional subtree (`{isOpen && (
 * <>… <SuppressWhileMounted target="all" /></>)}`) so its own mount/unmount
 * lifecycle — tied to the surface's real visibility — drives the suppression
 * instead.
 */
export function SuppressWhileMounted({ target }: { target: 'all' | (() => Rect | null) }) {
  useOverlaySuppression(target);
  return null;
}
