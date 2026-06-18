import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface FocusTrapOptions {
  isOpen: boolean;
  /** The dialog panel. Focus is trapped within it and restored on close. */
  panelRef: RefObject<HTMLElement | null>;
  /** Called on Escape (propagation is stopped so outer handlers don't double-fire). */
  onEscape?: () => void;
}

/**
 * Modal focus management for dialogs/sheets/overlays: traps Tab within the
 * panel, focuses the first focusable element (or the panel itself) on open, and
 * restores focus to the previously-focused element on close. Extracted so Sheet
 * and the generic Overlay share one implementation.
 */
export function useFocusTrap({ isOpen, panelRef, onEscape }: FocusTrapOptions) {
  // Hold the latest onEscape in a ref so an unstable handler identity from the
  // caller doesn't re-fire this effect (which would re-run focus-on-open and
  // park focus on the first focusable element on every parent re-render).
  const onEscapeRef = useRef(onEscape);
  useEffect(() => { onEscapeRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Focus the panel itself (tabIndex=-1), NOT the first focusable element —
      // otherwise the close X (first in DOM) gets highlighted and Space/Enter
      // closes the modal. Tab still cycles into content from here.
      panel.focus?.();
    });

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, panelRef]);
}
