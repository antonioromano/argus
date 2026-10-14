---
title: Startup beachball from per-file watchers (EMFILE + blocking FSEvents teardown)
date: 2026-07-12
category: docs/solutions/debugging/
module: server
problem_type: performance_issue
component: FileWatcherService
severity: critical
applies_when:
  - Changing FileWatcherService or adding any filesystem watcher
  - The app beachballs at startup, or /api/health stops answering
  - Considering chokidar or another per-file watcher library
tags:
  - fs-watch
  - fsevents
  - emfile
  - startup
  - freeze
---

## Root cause chain (v0.20.15–0.20.17)

1. chokidar v4 creates one watch handle per file and directory. One large repo (~8k directories)
   produced 4219 EMFILE errors and 83 s of setup in an isolated repro, **with a 1M fd limit**. Raising
   `ulimit` or calling `process.setFdLimit` cannot fix it; Chromium already raises fds to ~1M.
2. On EMFILE the error handler stopped the watcher. Closing tens of thousands of FSEvents handles
   blocks the main thread on a semaphore each time (`uv__fsevents_close → uv_sem_wait`, seen with
   `sample`). That was the beachball, and the server lives in Electron main.
3. Force-quitting the frozen app orphaned half-attached tmux clients, which spun at 100% CPU. tmux
   listed them as not attached, so `detach-client` couldn't evict them; only `kill -9` did. They never
   harmed the sessions.

## Fix (0.20.18)

`FileWatcherService` uses native `fs.watch(root, { recursive: true })`: **one FSEvents stream per
root**, exclusions filtered per event, and a 200 ms arming grace window (FSEvents replays pre-arm
changes at start). chokidar was removed.

Remaining work: one stream per *session* (not per root) and `node_modules` filtered in JS — see review
item P12.

## Techniques that worked

Run the packaged binary from a terminal to see stdout, `sample <pid>` during the freeze, `lsof -p` on
the spinners (pipes instead of a tty was the tell), and `tmux -L argus list-clients` to see real
attachment.
