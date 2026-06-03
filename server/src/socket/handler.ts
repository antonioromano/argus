import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import type { SessionManager } from '../services/SessionManager.js';
import type { AuthService } from '../services/AuthService.js';
import type { UpdateService } from '../services/UpdateService.js';
import { EphemeralTerminalManager } from '../services/EphemeralTerminalManager.js';

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

export function cleanupSessionDimensions(sessionId: string): void {
  clientDimensions.delete(sessionId);
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
 * PTY size for a session. If any mobile client is viewing it, fit the smallest
 * mobile client (a too-wide pty is unreadable on a phone; a desktop showing a
 * narrower pty merely letterboxes — the standard shared-terminal tradeoff).
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
    return { cols: minCols, rows: minRows };
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
  io.use((socket, next) => {
    if (!authService.enabled) {
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
      socket.join(sessionId);
      // Register this socket for dimension tracking
      if (!clientDimensions.has(sessionId)) {
        clientDimensions.set(sessionId, new Map());
      }
      // Replay a clean frame so the terminal isn't blank — and isn't garbled —
      // after reconnect/reload. For tmux sessions this is a fresh screen
      // snapshot; otherwise the raw rolling buffer.
      const buffer = manager.getReplaySnapshot(sessionId);
      if (buffer) {
        socket.emit('session:output', { sessionId, data: buffer });
      }
    });

    socket.on('session:leave', (sessionId: string) => {
      socket.leave(sessionId);
      // Remove this socket's dimensions and resize PTY to remaining max
      const sockets = clientDimensions.get(sessionId);
      if (sockets) {
        sockets.delete(socket.id);
        const dims = getSessionDimensions(sessionId);
        if (dims) {
          try { manager.resizeSession(sessionId, dims.cols, dims.rows); } catch { /* session may be gone */ }
        }
      }
      console.log(`Client ${socket.id} left session ${sessionId}`);
    });

    socket.on('session:input', ({ sessionId, data }) => {
      if (!manager.getSession(sessionId)) return;
      manager.writeToSession(sessionId, data);
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
      ephemeralManager.spawn(
        id,
        socket.id,
        cwd,
        120,
        30,
        (data) => socket.emit('ephemeral:output', { id, data }),
        (exitCode) => socket.emit('ephemeral:exit', { id, exitCode }),
      );
    });

    socket.on('ephemeral:input', ({ id, data }) => {
      ephemeralManager.write(id, data);
    });

    socket.on('ephemeral:resize', ({ id, cols, rows }) => {
      ephemeralManager.resize(id, cols, rows);
    });

    socket.on('ephemeral:kill', ({ id }) => {
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
        manager.companionTerminals.spawn(
          sessionId,
          session.folderPath,
          120,
          30,
          (data) => io.to(ctRoom).emit('ct:output', { sessionId, data }),
          (exitCode) => {
            io.to(ctRoom).emit('ct:exit', { sessionId, exitCode });
            clientDimensions.delete(ctRoom);
          },
        );
      } else {
        if (!clientDimensions.has(ctRoom)) {
          clientDimensions.set(ctRoom, new Map());
        }
      }

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
      manager.clearBuffer(sessionId);
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
            if (dims) {
              try { manager.resizeSession(roomKey, dims.cols, dims.rows); } catch { /* session may be gone */ }
            }
          }
        }
      }
      mobileSocketIds.delete(socket.id);
      // Kill all ephemeral terminals for this socket
      ephemeralManager.killAllForSocket(socket.id);
    });
  });
}
