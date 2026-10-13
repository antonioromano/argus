---
title: Argus window shows another app's UI — localhost resolves to ::1, and two servers can share a port
date: 2026-06-01
category: docs/solutions/debugging/
module: electron, server
problem_type: configuration_bug
component: electron/src/window.ts, server bind address, run-mode isolation
severity: high
applies_when:
  - An Argus window shows the wrong sessions or a different UI entirely
  - Changing the server bind host, the window URL, or default ports
  - Running a fork, the installed app and npm run dev side by side
tags:
  - ipv6
  - localhost
  - ports
  - isolation
  - electron
---

## Symptom

The Homebrew Argus window rendered a sibling fork wholesale: its UI, its sessions, everything. Only the
native menu and dock were Argus's.

## Root cause

- The window loaded `http://localhost:<port>`, while the server binds IPv4 `127.0.0.1` only. macOS
  resolves `localhost` to `::1` first.
- The fork listened on `*:<same port>`, which includes IPv6. An IPv4 server and an IPv6 server can hold
  the same port with no `EADDRINUSE`, so the window reached the fork.
- The whole frontend is served over HTTP by whatever answers the port (Electron loads an HTTP URL, not
  a `file://` into the asar), so the fork's UI replaced Argus's entirely.

## Fix and isolation rules

- The window loads `http://127.0.0.1:<port>`, an explicit IPv4 address that matches the bind
  (`electron/src/window.ts`).
- Each run mode gets its own port, userData profile, daemon/tmux socket label and deep-link scheme:
  packaged 5757 / `argus` / `argus://`, and `npm run dev` 5403 / `argus-dev` / `argus-dev://`. The
  installed app and dev can run at once.
- Env vars set inside an Argus terminal (e.g. `ARGUS_DAEMON_SOCKET=argus`) are inherited by anything
  started from it. Dev isolation forces its own labels, and argusd locks its data dir, so a mislabelled
  launch can't run the same sessions twice.

## Rule of thumb

When a surface shows the "wrong" sessions or UI, check `lsof -nP -iTCP:<port> -sTCP:LISTEN` for two
listeners on one port, and `localhost` vs `127.0.0.1`, before suspecting the data dir.
