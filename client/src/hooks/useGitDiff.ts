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
  refresh: () => void;
  contextLevels: Map<string, number>;
  expandFileContext: (filePath: string, source: 'unstaged' | 'staged' | 'branch') => void;
  expandingFiles: Set<string>;
}

export function useGitDiff({ sessionId, isOpen, sessionStatus }: UseGitDiffOptions): UseGitDiffResult {
  const [diff, setDiff] = useState<GitDiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevDiffRef = useRef<string>('');
  const fetchingRef = useRef(false);
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

  const fetchDiff = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    // Only show the spinner for the first load; background polls refresh silently.
    const isInitial = !initialLoadDoneRef.current;

    try {
      if (isInitial) setIsLoading(true);
      const result = await api.getSessionDiff(sessionId);

      if (result.error) {
        setError(result.error);
        setDiff(result);
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
              })
            );
          }

          if (expandPromises.length > 0) {
            await Promise.all(expandPromises);
          }

          const newKey = expandedResult.unstaged + '||' + expandedResult.staged + '||' + expandedResult.branch;
          if (newKey !== prevDiffRef.current) {
            prevDiffRef.current = newKey;
            setDiff(expandedResult);
          }
        } else {
          const newKey = result.unstaged + '||' + result.staged + '||' + result.branch;
          if (newKey !== prevDiffRef.current) {
            prevDiffRef.current = newKey;
            setDiff(result);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch diff');
    } finally {
      if (isInitial) {
        setIsLoading(false);
        initialLoadDoneRef.current = true;
      }
      fetchingRef.current = false;
    }
  }, [sessionId]);

  // Fetch on open
  useEffect(() => {
    if (!isOpen) {
      prevDiffRef.current = '';
      // Reset so the next open shows the spinner; subsequent polls stay silent.
      initialLoadDoneRef.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open is a legitimate external sync; fetchDiff sets loading state internally
    fetchDiff();
  }, [isOpen, fetchDiff]);

  // Poll when open, session is running, and tab is visible
  useEffect(() => {
    if (!isOpen || sessionStatus !== 'running' || !isTabVisible) return;

    const interval = setInterval(fetchDiff, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOpen, sessionStatus, isTabVisible, fetchDiff]);

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
      if (fileResult.error || !fileResult.diff) {
        setExpandingFiles(prev => {
          const next = new Set(prev);
          next.delete(fileKey);
          return next;
        });
        return;
      }

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
        prevDiffRef.current = updated.unstaged + '||' + updated.staged + '||' + updated.branch;
        return updated;
      });

      setExpandingFiles(prev => {
        const next = new Set(prev);
        next.delete(fileKey);
        return next;
      });
    });
  }, [sessionId]);

  return { diff, isLoading, error, refresh: fetchDiff, contextLevels, expandFileContext, expandingFiles };
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
