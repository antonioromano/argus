import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseGitDiffPanelResult {
  selectedFilePath: string | null;
  setSelectedFilePath: (path: string | null) => void;
  selectedSource: 'unstaged' | 'staged' | 'branch';
  setSelectedSource: (source: 'unstaged' | 'staged' | 'branch') => void;
  viewMode: 'split' | 'unified';
  toggleViewMode: () => void;
  userForcedSplit: boolean;
  contextLines: number;
  expandContext: () => void;
  blameActive: boolean;
  toggleBlame: () => void;
  showUntracked: boolean;
  toggleShowUntracked: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchActive: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelWidth: number;
  // Computed: auto-switch to unified when panel < 680px and user hasn't forced split
  effectiveViewMode: 'split' | 'unified';
  // Refs for wiring navigation callbacks from the panel
  nextHunkRef: React.MutableRefObject<(() => void) | null>;
  prevHunkRef: React.MutableRefObject<(() => void) | null>;
}

const NARROW_BREAKPOINT = 680;

export function useGitDiffPanel(): UseGitDiffPanelResult {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedSource, setSelectedSourceRaw] = useState<'unstaged' | 'staged' | 'branch'>('unstaged');
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [userForcedSplit, setUserForcedSplit] = useState(false);
  const [contextLines, setContextLines] = useState(3);
  const [blameActive, setBlameActive] = useState(false);
  const [showUntracked, setShowUntracked] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const nextHunkRef = useRef<(() => void) | null>(null);
  const prevHunkRef = useRef<(() => void) | null>(null);

  // Track panel width via ResizeObserver
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setPanelWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // effectiveViewMode: auto-switch to unified when panel is narrow and user hasn't forced split
  const effectiveViewMode = useMemo<'split' | 'unified'>(() => {
    if (viewMode === 'split' && (userForcedSplit || panelWidth >= NARROW_BREAKPOINT)) {
      return 'split';
    }
    return 'unified';
  }, [viewMode, userForcedSplit, panelWidth]);

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => {
      const currentEffective = prev === 'split' && (userForcedSplit || panelWidth >= NARROW_BREAKPOINT)
        ? 'split'
        : 'unified';
      if (currentEffective === 'unified' && prev === 'split') {
        // Switching from auto-unified to forced-split
        setUserForcedSplit(true);
        return 'split';
      }
      if (prev === 'split') {
        setUserForcedSplit(false);
        return 'unified';
      }
      return 'split';
    });
  }, [userForcedSplit, panelWidth]);

  const expandContext = useCallback(() => {
    setContextLines(prev => prev + 10);
  }, []);

  // Reset blameActive when source changes away from 'branch'
  const setSelectedSource = useCallback((source: 'unstaged' | 'staged' | 'branch') => {
    setSelectedSourceRaw(source);
    if (source !== 'branch') {
      setBlameActive(false);
    }
  }, []);

  const toggleBlame = useCallback(() => {
    setBlameActive(prev => !prev);
  }, []);

  const toggleShowUntracked = useCallback(() => {
    setShowUntracked(prev => !prev);
  }, []);

  const openSearch = useCallback(() => {
    setSearchActive(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchActive(false);
    setSearchQuery('');
  }, []);

  // Keyboard shortcuts: ] / [ for next/prev hunk, } / { for next/prev file, Meta+f/Ctrl+f for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!panelRef.current?.contains(document.activeElement)) return;

      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }

      if (isInput) return;

      if (e.key === ']') {
        e.preventDefault();
        nextHunkRef.current?.();
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        prevHunkRef.current?.();
        return;
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [openSearch]);

  return {
    selectedFilePath,
    setSelectedFilePath,
    selectedSource,
    setSelectedSource,
    viewMode,
    toggleViewMode,
    userForcedSplit,
    contextLines,
    expandContext,
    blameActive,
    toggleBlame,
    showUntracked,
    toggleShowUntracked,
    searchQuery,
    setSearchQuery,
    searchActive,
    openSearch,
    closeSearch,
    panelRef,
    panelWidth,
    effectiveViewMode,
    nextHunkRef,
    prevHunkRef,
  };
}
