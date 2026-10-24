import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Scroll bookkeeping shared by the file-by-file diff views (DiffWorkbench,
 * ReadOnlyDiff): which section is active (scroll-spy across the viewport's
 * middle), which sections are near enough to mount their heavy body (≈600px
 * render band), and a smooth scroll-to that the spy doesn't fight.
 *
 * Attach `mainRef` to the scroll container and pass `registerRef` to each
 * section, whose root must carry `data-file-id`.
 */
export function useFileScrollSpy(files: readonly { id: string }[]) {
  // Which file is "focused" — driven by scroll-spy, sidebar clicks and arrow keys.
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  // Sections within the render band mount their heavy diff body; the rest
  // render a height-estimated placeholder.
  const [nearIds, setNearIds] = useState<Set<string>>(() => new Set());
  // Set during a click/arrow-driven smooth scroll so the IntersectionObserver
  // doesn't fight it as intermediate sections cross the viewport middle.
  const programmaticRef = useRef<{ id: string; until: number } | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  }, []);

  // Resolve the highlighted file: the scroll-spy/arrow/click value when valid,
  // else the first file so the sidebar always shows a selection.
  const resolvedActiveId: string | null = useMemo(() => {
    if (activeFileId && files.some((f) => f.id === activeFileId)) return activeFileId;
    return files.length > 0 ? files[0].id : null;
  }, [files, activeFileId]);

  // Scroll a file's section into view and mark it active, suppressing the
  // observer briefly so it doesn't re-pick intermediate sections mid-animation.
  const scrollToFile = useCallback((id: string) => {
    const el = sectionRefs.current.get(id);
    setActiveFileId(id);
    if (!el) return;
    programmaticRef.current = { id, until: Date.now() + 700 };
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Scroll-spy: highlight whichever section crosses the viewport's vertical
  // middle. One observer rooted on <main>, observing section roots.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || files.length === 0) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.fileId;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const prog = programmaticRef.current;
        if (prog) {
          if (Date.now() < prog.until) return; // still animating to a clicked target
          programmaticRef.current = null;
        }
        const next = files.find((f) => visible.has(f.id))?.id;
        if (next) setActiveFileId((cur) => (cur === next ? cur : next));
      },
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    for (const f of files) {
      const el = sectionRefs.current.get(f.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [files]);

  // Render-band observer: mount bodies for sections within ~600px of the
  // viewport. Its initial callback populates the band on mount, so no separate
  // seeding is needed; ids of removed files linger harmlessly (never rendered).
  useEffect(() => {
    const root = mainRef.current;
    if (!root || files.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        setNearIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.fileId;
            if (!id) continue;
            if (e.isIntersecting && !next.has(id)) { next.add(id); changed = true; }
            else if (!e.isIntersecting && next.has(id)) { next.delete(id); changed = true; }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: '600px 0px 600px 0px', threshold: 0 },
    );
    for (const f of files) {
      const el = sectionRefs.current.get(f.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [files]);

  // A real wheel gesture cancels the click/arrow suppression window early.
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const clear = () => { programmaticRef.current = null; };
    root.addEventListener('wheel', clear, { passive: true });
    return () => root.removeEventListener('wheel', clear);
  }, []);

  return { mainRef, registerRef, resolvedActiveId, nearIds, scrollToFile };
}
