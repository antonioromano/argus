import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import type { SessionManager } from '../services/SessionManager.js';
import type { AuthService } from '../services/AuthService.js';
import type { UpdateService } from '../services/UpdateService.js';
import { EphemeralTerminalManager } from '../services/EphemeralTerminalManager.js';
import { createOutputCoalescer, type OutputCoalescer } from '../utils/outputCoalescer.js';
import { BROADCAST_RATE, SessionInputQueue, SlidingWindowLimiter, runBroadcast, validateBroadcast } from './broadcast.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// sessionId -> socketId -> { cols, rows }
// Tracks each connected client's terminal dimensions so the PTY is sized to
// the largest client rather than the most-recently-resized one.
const clientDimensions = new Map<string, Map<string, { cols: number; rows: number }>>();

// Socket ids connected from the mobile (/mobile) client. A phone shares the one
// pty/tmux client per session with any desktop viewers; sizing to the max would
// make claude's TUI wider than the phone and wrap/garble it. So when a mobile
// client is viewing a session we size the pty to the *smallest* mobile client
// (it fits the phone) — desktop-only sessions keep the max behavior.
const mobileSocketIds = new Set<string>();

// Companion-terminal output coalescers, by session id. Module-level because the
// companion outlives the socket that spawned it (it is broadcast to a room).
const ctCoalescers = new Map<string, OutputCoalescer>();

export function cleanupSessionDimensions(sessionId: string): void {
  clientDimensions.delete(sessionId);
  // CompanionTerminalManager.kill() unregisters before killing, so the companion's
  // onExit (the usual cleanup) is skipped on destroy — drop its coalescer here.
  ctCoalescers.get(sessionId)?.dispose();
  ctCoalescers.delete(sessionId);
}

function getMaxDimensions(sessionId: string): { cols: number; rows: number } | null {
  const sockets = clientDimensions.get(sessionId);
  if (!sockets || sockets.size === 0) return null;
  let maxCols = 0;
  let maxRows = 0;
  for (const { cols, rows } of sockets.values()) {
    if (cols > maxCols) maxCols = cols;
    if (rows > maxRows) maxRows = rows;
  }
  return maxCols > 0 && maxRows > 0 ? { cols: maxCols, rows: maxRows } : null;
}

/**
 * Row floor for the mobile fit below. A phone in LANDSCAPE has almost no vertical
 * room left once the input surface is on screen — measured at 8 rows on an iPhone
 * 15 Pro. Because the fit below takes the *smallest* mobile client, those 8 rows
 * would become the pty height for every viewer of the session, including a desktop
 * mosaic tile, and an agent redrawing into 8 rows is unusable. Clamp instead: the
 * phone then shows the bottom slice of a taller pty (its own scrollback holds the
 * rest), which is the lesser evil. Portrait is unaffected — it measures ~42 rows.
 */
export const MOBILE_MIN_ROWS = 20;

/**
 * PTY size for a session. If any mobile client is viewing it, fit the smallest
 * mobile client (a too-wide pty is unreadable on a phone; a desktop showing a
 * narrower pty merely letterboxes — the standard shared-terminal tradeoff),
 * subject to MOBILE_MIN_ROWS so one landscape phone can't starve everyone.
 * Otherwise size to the largest client (unchanged desktop/mosaic behavior).
 */
function getSessionDimensions(sessionId: string): { cols: number; rows: number } | null {
  const sockets = clientDimensions.get(sessionId);
  if (!sockets || sockets.size === 0) return null;

  let minCols = Infinity;
  let minRows = Infinity;
  let hasMobile = false;
  for (const [socketId, { cols, rows }] of sockets) {
    if (!mobileSocketIds.has(socketId)) continue;
    hasMobile = true;
    if (cols < minCols) minCols = cols;
    if (rows < minRows) minRows = rows;
  }
  if (hasMobile && minCols > 0 && minRows > 0 && minCols !== Infinity && minRows !== Infinity) {
    return { cols: minCols, rows: Math.max(minRows, MOBILE_MIN_ROWS) };
  }
  return getMaxDimensions(sessionId);
}

const ephemeralManager = new EphemeralTerminalManager();

export function setupSocketHandler(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  manager: SessionManager,
  authService: AuthService,
  updateService: UpdateService,
): void {
  // One input queue for all connections: keystrokes and broadcasts to a session
  // stay in order even when they come from different windows.
  const inputQueue = new SessionInputQueue((id, data) => manager.writeToSession(id, data));

  io.use((socket, next) => {
    if (!authService.enforced) {
      next();
      return;
    }
    const token = socket.handshake.auth?.token as string | undefined;
    if (token && authService.validateToken(token)) {
      next();
    } else {
      next(new Error('Authentication required'));
    }
  });

  io.on('connection', (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);
    // This socket's ephemeral-terminal output coalescers, by terminal id.
    const ephemeralCoalescers = new Map<string, OutputCoalescer>();
    if (socket.handshake.query?.client === 'mobile') {
      mobileSocketIds.add(socket.id);
    }
    // Re-emit cached update status so late-joining clients see the button,
    // then trigger a fresh check (cooldown-guarded to avoid hammering GitHub)
    updateService.broadcastToSocket(socket);
    void updateService.checkForUpdate();

    socket.on('session:join', (sessionId: string) => {
      if (!manager.getSession(sessionId)) {
        socket.emit('session:error', { sessionId, message: 'Session not found' });
        return;
      }
      // Flush coalesced output to the room BEFORE this socket joins it: pending
      // bytes are already baked into the mirror, so the replay frame below covers
      // them — receiving the flush after joining would paint them twice.
      manager.flushOutput(sessionId);
      socket.join(sessionId);
      // A viewer is back before the idle resize landed → it never happens, so
      // ordinary navigation costs the agent no SIGWINCH repaint at all.
      manager.cancelIdleGeometry(sessionId);
      // Register this socket for dimension tracking
      if (!clientDimensions.has(sessionId)) {
        clientDimensions.set(sessionId, new Map());
      }
      // Replay a clean frame so the terminal isn't blank — and isn't garbled —
      // after reconnect/reload. For tmux sessions this is a fresh screen
      // snapshot; otherwise the raw rolling buffer. Sent as session:replay (not
      // session:output) so the client reconciles its buffer/mouse state to tmux
      // before painting — see SessionReplay.
      const replay = manager.getReplaySnapshot(sessionId);
      if (replay) {
        socket.emit('session:replay', { sessionId, ...replay });
      }
    });

    // A client already in the room whose screen drifted out of alignment (refit,
    // output settle). Unlike a join it must NOT cost the reader their scroll
    // position, so it is answered with a screen-only frame — no history, no
    // `\x1b[3J`. Same flush-before-frame invariant as join: pending coalesced
    // bytes are already baked into the mirror, so the frame covers them.
    socket.on('session:resync', (sessionId: string) => {
      if (!manager.getSession(sessionId)) return;
      manager.flushOutput(sessionId);
      const replay = manager.getReplaySnapshot(sessionId, 'screen');
      if (replay) {
        socket.emit('session:replay', { sessionId, ...replay, reason: 'resync' });
      }
    });

    socket.on('session:leave', (sessionId: string) => {
      socket.leave(sessionId);
      // Deliberately NOT trimming the mirror here. Its scrollback is the ceiling
      // on what any client can scroll back to (a join answers with a full frame
      // opening ED 3, which replaces the client's own buffer), and an xterm
      // scrollback shrink drops the oldest rows for good. Trimming on leave made
      // an ordinary tile unmount — minimize, mosaic → focus — quietly destroy
      // history that an idle session then never refilled.
      // Remove this socket's dimensions and resize PTY to remaining max
      const sockets = clientDimensions.get(sessionId);
      if (sockets) {
        sockets.delete(socket.id);
        const dims = getSessionDimensions(sessionId);
        try {
          // No viewers left → hand it a tall screen so the agent's repaints fit
          // (see IDLE_MIN_ROWS). Skipping this leaves the pty frozen at the last
          // tile's height, and a minimized mosaic tile is ~12–25 rows. Deferred:
          // a viewer that returns within the grace window cancels it.
          if (dims) manager.resizeSession(sessionId, dims.cols, dims.rows);
          else manager.scheduleIdleGeometry(sessionId);
        } catch { /* session may be gone */ }
      }
      console.log(`Client ${socket.id} left session ${sessionId}`);
    });

    socket.on('session:input', ({ sessionId, data }) => {
      if (!manager.getSession(sessionId)) return;
      // Through the queue so a keystroke can't land between a broadcast's text
      // and its Enter; a write error (session exited meanwhile) is swallowed.
      inputQueue.write(sessionId, data);
    });

    // Broadcast input (F4): same text into several shells. Validated (known ids,
    // length cap, single line), rate-limited per socket, and written through
    // the session:input path above.
    const broadcastLimiter = new SlidingWindowLimiter(BROADCAST_RATE.max, BROADCAST_RATE.windowMs);
    socket.on('session:broadcast', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const req = validateBroadcast(payload, (id) => !!manager.getSession(id));
      if (!req.ok) {
        reply(req);
        return;
      }
      if (!broadcastLimiter.take()) {
        reply({ ok: false, error: 'Too many broadcasts — wait a few seconds' });
        return;
      }
      reply(runBroadcast(req, (id) => {
        const s = manager.getSession(id);
        return !!s && s.status !== 'exited';
      }, inputQueue));
    });

    socket.on('session:answer', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const { sessionId, key } = (payload ?? {}) as { sessionId?: unknown; key?: unknown };
      if (typeof sessionId !== 'string') { reply({ ok: false, error: 'Invalid request' }); return; }
      const error = manager.checkPromptAnswer(sessionId, key);
      if (error) { reply({ ok: false, error }); return; }
      inputQueue.write(sessionId, key as string);
      reply({ ok: true });
    });

    socket.on('session:resize', ({ sessionId, cols, rows }) => {
      if (!manager.getSession(sessionId)) return;
      // Store this client's dimensions
      const sockets = clientDimensions.get(sessionId);
      if (sockets) {
        sockets.set(socket.id, { cols, rows });
      }
      // Size the PTY: smallest mobile viewer if any, else largest client.
      const dims = getSessionDimensions(sessionId) ?? { cols, rows };
      try {
        manager.resizeSession(sessionId, dims.cols, dims.rows);
      } catch { /* session may have exited between guard check and resize */ }
    });

    // Ephemeral terminal events (Explorer view — not persisted, not in session list)
    socket.on('ephemeral:spawn', ({ id, cwd }) => {
      // Containment: only spawn a shell inside a folder Argus actually manages a
      // session for. Without this an (authenticated) client — including one on
      // the mobile tunnel — could open a login shell at any path on the host,
      // escaping the session sandbox every other fs/git route enforces.
      const safeCwd = manager.resolveWithinAnySession(cwd);
      if (!safeCwd) {
        socket.emit('ephemeral:exit', { id, exitCode: -1 });
        return;
      }
      // Coalesced like session:output (per-chunk emits starve the renderer).
      // spawn() replaces any terminal already using this id, so retire its
      // coalescer first — its bytes belong before the new shell's.
      ephemeralCoalescers.get(id)?.dispose();
      const out = createOutputCoalescer((data) => socket.emit('ephemeral:output', { id, data }));
      ephemeralCoalescers.set(id, out);
      ephemeralManager.spawn(
        id,
        socket.id,
        safeCwd,
        120,
        30,
        (data) => out.push(data),
        (exitCode) => {
          out.dispose(); // output first, then the exit
          if (ephemeralCoalescers.get(id) === out) ephemeralCoalescers.delete(id);
          socket.emit('ephemeral:exit', { id, exitCode });
        },
      );
    });

    socket.on('ephemeral:input', ({ id, data }) => {
      ephemeralManager.write(id, data);
    });

    socket.on('ephemeral:resize', ({ id, cols, rows }) => {
      ephemeralManager.resize(id, cols, rows);
    });

    socket.on('ephemeral:kill', ({ id }) => {
      ephemeralCoalescers.get(id)?.dispose();
      ephemeralCoalescers.delete(id);
      ephemeralManager.kill(id);
    });

    // Companion terminal events (one per session, persists while parent session is alive)
    socket.on('ct:join', (sessionId: string) => {
      const session = manager.getSession(sessionId);
      if (!session) return;

      const ctRoom = `ct:${sessionId}`;

      if (!manager.companionTerminals.isAlive(sessionId)) {
        // Register dimension tracking before spawning so the room key exists
        if (!clientDimensions.has(ctRoom)) {
          clientDimensions.set(ctRoom, new Map());
        }
        // Coalesced like session:output; see ctCoalescers.
        ctCoalescers.get(sessionId)?.dispose();
        const out = createOutputCoalescer((data) => io.to(ctRoom).emit('ct:output', { sessionId, data }));
        ctCoalescers.set(sessionId, out);
        manager.companionTerminals.spawn(
          sessionId,
          session.folderPath,
          120,
          30,
          (data) => out.push(data),
          (exitCode) => {
            out.dispose(); // output first, then the exit
            if (ctCoalescers.get(sessionId) === out) ctCoalescers.delete(sessionId);
            io.to(ctRoom).emit('ct:exit', { sessionId, exitCode });
            clientDimensions.delete(ctRoom);
          },
        );
      } else {
        if (!clientDimensions.has(ctRoom)) {
          clientDimensions.set(ctRoom, new Map());
        }
      }

      // Same invariant as session:join: pending bytes are already in the
      // companion buffer replayed below, so emit them to the room BEFORE this
      // socket joins it — after would paint them twice.
      ctCoalescers.get(sessionId)?.flush();
      void socket.join(ctRoom);
      const buffer = manager.companionTerminals.getBuffer(sessionId);
      if (buffer) {
        socket.emit('ct:output', { sessionId, data: buffer });
      }
    });

    socket.on('ct:leave', (sessionId: string) => {
      const ctRoom = `ct:${sessionId}`;
      void socket.leave(ctRoom);
      const sockets = clientDimensions.get(ctRoom);
      if (sockets) {
        sockets.delete(socket.id);
        const max = getMaxDimensions(ctRoom);
        if (max) {
          manager.companionTerminals.resize(sessionId, max.cols, max.rows);
        }
      }
    });

    socket.on('ct:input', ({ sessionId, data }) => {
      manager.companionTerminals.write(sessionId, data);
    });

    socket.on('ct:resize', ({ sessionId, cols, rows }) => {
      const ctRoom = `ct:${sessionId}`;
      const sockets = clientDimensions.get(ctRoom);
      if (sockets) {
        sockets.set(socket.id, { cols, rows });
      }
      const max = getMaxDimensions(ctRoom) ?? { cols, rows };
      manager.companionTerminals.resize(sessionId, max.cols, max.rows);
    });

    socket.on('session:clear-buffer', (sessionId: string) => {
      if (!manager.getSession(sessionId)) return;
      // Fire-and-forget: the mirror write queue orders the clear against pending
      // output, and the authoritative repaint is broadcast when it lands.
      void manager.clearBuffer(sessionId);
    });

    // Client opened/focused a session — clear an unacknowledged 'done' status.
    socket.on('session:seen', (sessionId: string) => {
      if (!manager.getSession(sessionId)) return;
      manager.acknowledgeSession(sessionId);
    });

    // Client manually promotes an idle session to done.
    socket.on('session:mark-done', (sessionId: string) => {
      if (!manager.getSession(sessionId)) return;
      manager.markSessionDone(sessionId);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      // Clean up dimensions for all sessions and companion terminals this socket was part of
      for (const [roomKey, sockets] of clientDimensions) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (roomKey.startsWith('ct:')) {
            const sessionId = roomKey.slice(3);
            const max = getMaxDimensions(roomKey);
            if (max) {
              manager.companionTerminals.resize(sessionId, max.cols, max.rows);
            }
          } else {
            // Recompute AFTER removing this socket so a departing phone reverts
            // the session to the desktop's size.
            const dims = getSessionDimensions(roomKey);
            try {
              // Same idle-geometry handoff as session:leave — a closed window is
              // just a viewer that left without saying so, and a dropped socket
              // is usually one that reconnects in seconds.
              if (dims) manager.resizeSession(roomKey, dims.cols, dims.rows);
              else manager.scheduleIdleGeometry(roomKey);
            } catch { /* session may be gone */ }
            // No mirror trim here either — same reason as session:leave. A
            // dropped socket is usually one that reconnects in seconds, and it
            // must not cost the session rows no one can bring back.
          }
        }
      }
      mobileSocketIds.delete(socket.id);
      // Kill all ephemeral terminals for this socket
      for (const out of ephemeralCoalescers.values()) out.dispose();
      ephemeralCoalescers.clear();
      ephemeralManager.killAllForSocket(socket.id);
    });
  });
}
