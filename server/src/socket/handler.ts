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
      // Replay buffered output so terminal isn't blank after reconnect
      const buffer = manager.getSessionBuffer(sessionId);
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
        const max = getMaxDimensions(sessionId);
        if (max) {
          try { manager.resizeSession(sessionId, max.cols, max.rows); } catch { /* session may be gone */ }
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
      // Resize PTY to the maximum dimensions across all connected clients
      const max = getMaxDimensions(sessionId) ?? { cols, rows };
      try {
        manager.resizeSession(sessionId, max.cols, max.rows);
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
            const max = getMaxDimensions(roomKey);
            if (max) {
              try { manager.resizeSession(roomKey, max.cols, max.rows); } catch { /* session may be gone */ }
            }
          }
        }
      }
      // Kill all ephemeral terminals for this socket
      ephemeralManager.killAllForSocket(socket.id);
    });
  });
}
