import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Close a fixed-position popover (portalled to <body>) the usual ways: a press
 * outside every element in `inside` (the trigger counts as inside, so it can
 * toggle the popover itself), Escape, a scroll anywhere but inside `floating`
 * (it would leave the popover behind its trigger), or a window resize.
 * Listeners are on the capture phase and live only while `active`.
 */
export function usePopoverDismiss(
  active: boolean,
  inside: readonly RefObject<HTMLElement | null>[],
  floating: RefObject<HTMLElement | null>,
  onClose: (reason: 'outside' | 'escape' | 'scroll' | 'resize') => void,
): void {
  // Latest values, so a new inline callback or array each render doesn't re-bind.
  const latest = useRef({ inside, floating, onClose });
  useLayoutEffect(() => { latest.current = { inside, floating, onClose }; });

  useEffect(() => {
    if (!active) return;
    const close = (reason: Parameters<typeof onClose>[0]) => latest.current.onClose(reason);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!latest.current.inside.some((r) => r.current?.contains(t))) close('outside');
    };
    const onScroll = (e: Event) => {
      if (!latest.current.floating.current?.contains(e.target as Node)) close('scroll');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close('escape');
    };
    const onResize = () => close('resize');
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [active]);
}
