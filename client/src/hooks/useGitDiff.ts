import { useState, useEffect, useCallback, useRef } from 'react';
import parseDiff from 'parse-diff';
import type { GitDiffResponse, SessionStatus } from '@argus/shared';
import { api } from '../services/api.js';

const POLL_INTERVAL_MS = 3000;
const CONTEXT_INCREMENT = 20;
const DEFAULT_CONTEXT = 3;

interface UseGitDiffOptions {
  sessionId: string;
  isOpen: boolean;
  sessionStatus: SessionStatus;
}

interface UseGitDiffResult {
  diff: GitDiffResponse | null;
  isLoading: boolean;
  error: string | null;
  /** Refetch now. Called while a fetch is in flight, it queues ONE trailing
   *  refetch (so a stage/unstage isn't masked by a stale poll result) and the
   *  returned promise settles after that trailing fetch. */
  refresh: () => Promise<void>;
  contextLevels: Map<string, number>;
  expandFileContext: (filePath: string, source: 'unstaged' | 'staged' | 'branch') => void;
  expandingFiles: Set<string>;
}

export function useGitDiff({ sessionId, isOpen, sessionStatus }: UseGitDiffOptions): UseGitDiffResult {
  const [diff, setDiff] = useState<GitDiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevDiffRef = useRef<string>('');
  // The fetch currently on the wire, and the single trailing refetch queued
  // behind it by refresh() calls that arrived meanwhile.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const trailingRef = useRef<Promise<void> | null>(null);
  // Drives the loading spinner only on the first fetch (or on open); background
  // polls refresh silently so isLoading doesn't flip twice every poll tick.
  const initialLoadDoneRef = useRef(false);
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden);
  const [contextLevels, setContextLevels] = useState<Map<string, number>>(new Map());
  const [expandingFiles, setExpandingFiles] = useState<Set<string>>(new Set());
  const contextLevelsRef = useRef(contextLevels);
  useEffect(() => { contextLevelsRef.current = contextLevels; }, [contextLevels]);

  useEffect(() => {
    const handler = () => setIsTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const runFetch = useCallback(async () => {
    // Only show the spinner for the first load; background polls refresh silently.
    const isInitial = !initialLoadDoneRef.current;

    try {
      if (isInitial) setIsLoading(true);
      const result = await api.getSessionDiff(sessionId);

      if (result.error) {
        setError(result.error);
        setDiff(result);
        // The rendered diff is now the error payload: the next good response must
        // replace it even if it equals the last good one.
        prevDiffRef.current = '';
      } else {
        setError(null);

        // For files with expanded context, re-fetch with the right -U value
        const levels = contextLevelsRef.current;
        if (levels.size > 0) {
          const expandedResult = { ...result };

          // Parse diffs to find file paths
          const unstagedFiles = result.unstaged ? parseDiff(result.unstaged) : [];
          const stagedFiles = result.staged ? parseDiff(result.staged) : [];
          const branchFiles = result.branch ? parseDiff(result.branch) : [];

          const expandPromises: Promise<void>[] = [];

          for (const [fileKey, ctx] of levels) {
            // fileKey format: "source:filePath"
            const colonIdx = fileKey.indexOf(':');
            const source = fileKey.slice(0, colonIdx) as 'unstaged' | 'staged' | 'branch';
            const filePath = fileKey.slice(colonIdx + 1);

            // Check if this file still exists in the diff
            const filesForSource = source === 'unstaged' ? unstagedFiles
              : source === 'staged' ? stagedFiles
              : branchFiles;
            const stillExists = filesForSource.some(f => (f.to === '/dev/null' ? f.from : f.to) === filePath);
            if (!stillExists) continue;

            expandPromises.push(
              api.getFileDiff(sessionId, filePath, ctx, source).then(fileResult => {
                if (fileResult.error || !fileResult.diff) return;
                // Replace the file's diff in the appropriate raw string
                // We need to replace the file's section in the raw diff string
                if (source === 'unstaged') {
                  expandedResult.unstaged = replaceFileDiff(expandedResult.unstaged, filePath, fileResult.diff);
                } else if (source === 'staged') {
                  expandedResult.staged = replaceFileDiff(expandedResult.staged, filePath, fileResult.diff);
                } else {
                  expandedResult.branch = replaceFileDiff(expandedResult.branch, filePath, fileResult.diff);
                }
              }).catch(() => {
                // Keep the default-context section for this file; one failed
                // expansion must not fail the whole refresh.
              })
            );
          }

          if (expandPromises.length > 0) {
            await Promise.all(expandPromises);
          }

          const newKey = diffKey(expandedResult);
          if (newKey !== prevDiffRef.current) {
            prevDiffRef.current = newKey;
            setDiff(expandedResult);
          }
        } else {
          const newKey = diffKey(result);
          if (newKey !== prevDiffRef.current) {
            prevDiffRef.current = newKey;
            setDiff(result);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch diff');
      prevDiffRef.current = '';
    } finally {
      if (isInitial) {
        setIsLoading(false);
        initialLoadDoneRef.current = true;
      }
    }
  }, [sessionId]);

  const startFetch = useCallback((): Promise<void> => {
    const p = runFetch().finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    inFlightRef.current = p;
    return p;
  }, [runFetch]);

  /** Background poll: skip the tick if a fetch is already on the wire. */
  const pollDiff = useCallback(() => {
    if (inFlightRef.current) return;
    void startFetch();
  }, [startFetch]);

  const fetchDiff = useCallback((): Promise<void> => {
    const inFlight = inFlightRef.current;
    if (!inFlight) return startFetch();
    if (!trailingRef.current) {
      const trailing = inFlight.then(() => {
        trailingRef.current = null;
        return startFetch();
      });
      trailingRef.current = trailing;
    }
    return trailingRef.current;
  }, [startFetch]);

  // Fetch on open
  useEffect(() => {
    if (!isOpen) {
      prevDiffRef.current = '';
      // Reset so the next open shows the spinner; subsequent polls stay silent.
      initialLoadDoneRef.current = false;
      return;
    }
    void fetchDiff();
  }, [isOpen, fetchDiff]);

  // Poll when open, session is running, and tab is visible
  useEffect(() => {
    if (!isOpen || sessionStatus !== 'running' || !isTabVisible) return;

    const interval = setInterval(pollDiff, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOpen, sessionStatus, isTabVisible, pollDiff]);

  const expandFileContext = useCallback((filePath: string, source: 'unstaged' | 'staged' | 'branch') => {
    const fileKey = `${source}:${filePath}`;
    const currentLevel = contextLevelsRef.current.get(fileKey) ?? DEFAULT_CONTEXT;
    const newLevel = currentLevel + CONTEXT_INCREMENT;

    setContextLevels(prev => {
      const next = new Map(prev);
      next.set(fileKey, newLevel);
      return next;
    });

    // Immediately fetch the expanded diff for this file
    setExpandingFiles(prev => new Set(prev).add(fileKey));

    api.getFileDiff(sessionId, filePath, newLevel, source).then(fileResult => {
      if (fileResult.error || !fileResult.diff) return;

      setDiff(prev => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (source === 'unstaged') {
          updated.unstaged = replaceFileDiff(updated.unstaged, filePath, fileResult.diff);
        } else if (source === 'staged') {
          updated.staged = replaceFileDiff(updated.staged, filePath, fileResult.diff);
        } else {
          updated.branch = replaceFileDiff(updated.branch, filePath, fileResult.diff);
        }
        prevDiffRef.current = diffKey(updated);
        return updated;
      });
    }).catch(() => {
      // Network/HTTP failure: keep the current context; the finally clears the spinner.
    }).finally(() => {
      setExpandingFiles(prev => {
        const next = new Set(prev);
        next.delete(fileKey);
        return next;
      });
    });
  }, [sessionId]);

  return { diff, isLoading, error, refresh: fetchDiff, contextLevels, expandFileContext, expandingFiles };
}

/** Change-detection key over the WHOLE response — untracked files, their diff
 *  and the oversized list included (a new untracked file changes nothing else). */
function diffKey(d: GitDiffResponse): string {
  return JSON.stringify([d.unstaged, d.staged, d.branch, d.untracked, d.untrackedDiff, d.oversized ?? null, d.error ?? null]);
}

/**
 * Replace a single file's diff section within a full multi-file diff string.
 * Finds the file's "diff --git a/... b/..." block and replaces it entirely.
 */
function replaceFileDiff(fullDiff: string, filePath: string, newFileDiff: string): string {
  // Find the start of this file's diff block
  // Handles both normal and renamed paths
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fileStartRegex = new RegExp(`^diff --git [ab]/.* [ab]/${escapedPath}$`, 'm');
  const match = fullDiff.match(fileStartRegex);
  if (!match || match.index === undefined) {
    // Also try matching on the "from" side (for renames)
    const fileStartRegex2 = new RegExp(`^diff --git [ab]/${escapedPath} [ab]/.*$`, 'm');
    const match2 = fullDiff.match(fileStartRegex2);
    if (!match2 || match2.index === undefined) return fullDiff;
    return replaceAtFileBlock(fullDiff, match2.index, newFileDiff);
  }
  return replaceAtFileBlock(fullDiff, match.index, newFileDiff);
}

function replaceAtFileBlock(fullDiff: string, startIndex: number, newFileDiff: string): string {
  // Find the end of this file's diff (start of next "diff --git" or end of string)
  const nextFileStart = fullDiff.indexOf('\ndiff --git ', startIndex + 1);
  const endIndex = nextFileStart === -1 ? fullDiff.length : nextFileStart + 1;

  const before = fullDiff.slice(0, startIndex);
  const after = fullDiff.slice(endIndex);

  // Ensure newFileDiff ends with newline
  const normalized = newFileDiff.endsWith('\n') ? newFileDiff : newFileDiff + '\n';
  return before + normalized + after;
}
