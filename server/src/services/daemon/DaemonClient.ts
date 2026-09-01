import net from 'net';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';

const KIND_CONTROL = 0x43; // 'C'
const KIND_DATA = 0x44; // 'D'
const PROTOCOL_VERSION = 1;
const CONNECT_TIMEOUT_MS = 3000;
const CONNECT_RETRY_MS = 100;
/** Backoff bounds for reconnecting after the daemon drops us. */
const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 5000;
/**
 * Attach pacing (see the attach queue below). The daemon acks an attach once it
 * has finished replaying that session's backlog; these bound how long we wait
 * for an ack that may never come — an argusd predating the ack still runs on
 * this machine until its last session ends, and it must not wedge a restore.
 *
 * QUIET: no bytes for this long after the attach means the backlog is done (or
 * was empty). HARD: a ceiling for a session whose output never goes quiet.
 */
const ATTACH_QUIET_MS = 500;
const ATTACH_HARD_MS = 45_000;

export interface DaemonClientOptions {
  /** Ceiling on one attach before the next is sent anyway. */
  attachAckTimeoutMs?: number;
  /** Silence after an attach that counts as "backlog delivered". */
  attachQuietMs?: number;
}

interface Control {
  op: string;
  id?: string;
  cmd?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  code?: number;
  sessions?: string[];
  version?: number;
  msg?: string;
}

/**
 * Client for a single argusd daemon (plan 2026-07-22-003). Ensures the daemon is
 * running (spawning it detached if the socket is dead), performs the version
 * handshake, and demultiplexes the length-prefixed frame stream into per-session
 * `data:<id>` / `exit:<id>` events plus connection-level events (`connected`,
 * `disconnected`, `versionMismatch`). Single-consumer: one client per daemon.
 */
export class DaemonClient extends EventEmitter {
  private sock: net.Socket | null = null;
  // Widened generic: subarray()/concat() return Buffer<ArrayBufferLike>.
  private rx: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private connected = false;
  private connecting: Promise<void> | null = null;
  private listPending: ((ids: string[]) => void)[] = [];
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  /**
   * Attaches are queued and sent ONE AT A TIME.
   *
   * An app restart attaches every restored session at once. Each attach makes
   * the daemon replay that session's whole ring (up to 2MB), and a burst of
   * them lands in the daemon's bounded outbox as one lump: past 8MB it judges
   * this process dead, drops the connection and discards the queued replay. The
   * reconnect re-attaches everything and reproduces the same burst, so every
   * restored terminal stays blank — an idle agent sends nothing to repaint it.
   * Serialising the attaches keeps at most one ring in flight.
   */
  private attachQueue: { id: string; beforeSend?: () => void }[] = [];
  private attachInFlight: { id: string; hard: ReturnType<typeof setTimeout>; quiet: ReturnType<typeof setTimeout> } | null = null;
  private attachHardMs: number;
  private attachQuietMs: number;

  constructor(
    private socketPath: string,
    private binPath: string,
    private socketLabel: string,
    opts: DaemonClientOptions = {},
  ) {
    super();
    this.attachHardMs = opts.attachAckTimeoutMs ?? ATTACH_HARD_MS;
    this.attachQuietMs = opts.attachQuietMs ?? ATTACH_QUIET_MS;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Connect to the daemon, spawning it if the socket is dead. Idempotent. */
  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doEnsure().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doEnsure(): Promise<void> {
    try {
      await this.tryConnect();
      return;
    } catch {
      // Socket dead/absent — spawn the daemon detached, then retry until it's up.
    }
    this.spawnDaemon();
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    for (;;) {
      await delay(CONNECT_RETRY_MS);
      try {
        await this.tryConnect();
        return;
      } catch {
        if (Date.now() > deadline) throw new Error('argusd did not come up in time');
      }
    }
  }

  private tryConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      let settled = false;
      const onErr = (err: Error) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(err);
      };
      sock.once('error', onErr);
      sock.once('connect', () => {
        // Wait for the hello frame before declaring the connection live so a
        // version mismatch is caught up front.
        this.sock = sock;
        this.rx = Buffer.alloc(0);
        sock.removeListener('error', onErr);
        // A daemon already serving another consumer accepts the connection and
        // closes it without a hello. Settling only on 'hello' left this promise
        // — and every caller awaiting backend.ready() — pending forever, so a
        // pre-hello close has to reject and let the reconnect backoff retry.
        const onHello = () => {
          if (settled) return;
          settled = true;
          this.connected = true;
          this.emit('connected');
          this.pumpAttach();
          resolve();
        };
        const closedEarly = () => {
          if (!settled) {
            settled = true;
            // The retry loop reconnects; leaving this listener behind would pile
            // one up per attempt (and fire it against a dead socket).
            this.removeListener('hello', onHello);
            sock.destroy();
            reject(new Error('daemon closed the connection before the handshake'));
            return;
          }
          this.handleClose();
        };
        sock.on('error', closedEarly);
        sock.on('close', closedEarly);
        sock.on('data', (chunk) => this.onBytes(chunk));
        this.once('hello', onHello);
      });
    });
  }

  private spawnDaemon(): void {
    const child = spawn(this.binPath, [this.socketPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ARGUS_DAEMON_SOCKET: this.socketLabel },
    });
    // An unspawnable binary emits 'error' asynchronously; unhandled, that is an
    // uncaught exception in the Electron main process. The connect retry loop
    // reports the failure properly on its own deadline.
    child.on('error', (err) => console.warn('[argusd] could not spawn daemon:', err.message));
    child.unref();
  }

  private handleClose(): void {
    if (!this.sock) return;
    this.sock.removeAllListeners();
    this.sock = null;
    // Anything queued was for a connection that no longer exists; the reconnect
    // path re-attaches every session from scratch.
    this.clearAttachState();
    const was = this.connected;
    this.connected = false;
    if (was) {
      console.warn('[argusd] connection lost — sessions keep running, reconnecting');
      this.emit('disconnected');
    }
    this.scheduleReconnect();
  }

  /**
   * Come back after a drop. The daemon closes the connection when its outbox
   * overflows — i.e. when this process stopped draining the socket long enough
   * to look dead — and its sessions deliberately survive that. Without a
   * reconnect the agents keep running with nobody listening and every terminal
   * in the app is frozen until a restart.
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || this.connected) return;
    const delayMs = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.connected) return;
      void this.ensureConnected()
        .then(() => {
          this.reconnectDelay = RECONNECT_MIN_MS;
          console.log('[argusd] reconnected — re-attaching sessions');
          this.emit('reconnected');
        })
        .catch((err) => {
          console.warn('[argusd] reconnect failed, retrying:', (err as Error)?.message);
          this.scheduleReconnect();
        });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private onBytes(chunk: Buffer): void {
    this.rx = this.rx.length ? Buffer.concat([this.rx, chunk]) : chunk;
    for (;;) {
      if (this.rx.length < 4) return;
      const len = this.rx.readUInt32BE(0);
      if (this.rx.length < 4 + len) return;
      const body = this.rx.subarray(4, 4 + len);
      this.rx = this.rx.subarray(4 + len);
      this.dispatchFrame(body);
    }
  }

  private dispatchFrame(body: Buffer): void {
    if (body.length < 2) return;
    const kind = body[0]!;
    const idLen = body[1]!;
    const id = body.subarray(2, 2 + idLen).toString('utf8');
    const payload = body.subarray(2 + idLen);
    if (kind === KIND_DATA) {
      if (this.attachInFlight?.id === id) this.armAttachQuiet();
      this.emit(`data:${id}`, payload);
      return;
    }
    if (kind === KIND_CONTROL) {
      let ctl: Control;
      try {
        ctl = JSON.parse(payload.toString('utf8')) as Control;
      } catch {
        return;
      }
      this.onControl(ctl);
    }
  }

  private onControl(ctl: Control): void {
    switch (ctl.op) {
      case 'hello':
        if (ctl.version !== PROTOCOL_VERSION) {
          this.emit('versionMismatch', ctl.version);
        }
        this.emit('hello');
        break;
      case 'attached':
        // Backlog for this session is complete — release the next attach.
        if (ctl.id && this.attachInFlight?.id === ctl.id) this.finishAttach();
        break;
      case 'exit':
        if (ctl.id) this.emit(`exit:${ctl.id}`, ctl.code ?? 0);
        break;
      case 'list': {
        const resolve = this.listPending.shift();
        if (resolve) resolve(ctl.sessions ?? []);
        break;
      }
      // 'spawned' / 'error' / 'pong' — currently informational; spawn is
      // fire-and-forget (output/exit events carry the real signal).
    }
  }

  private send(ctl: Control): void {
    if (!this.sock) return;
    this.writeFrame(KIND_CONTROL, '', Buffer.from(JSON.stringify(ctl), 'utf8'));
  }

  private writeFrame(kind: number, id: string, payload: Buffer): void {
    if (!this.sock) return;
    const idBuf = Buffer.from(id, 'utf8');
    const body = Buffer.concat([Buffer.from([kind, idBuf.length]), idBuf, payload]);
    const hdr = Buffer.alloc(4);
    hdr.writeUInt32BE(body.length, 0);
    this.sock.write(Buffer.concat([hdr, body]));
  }

  // ---- session ops ----
  spawn(id: string, argv: string[], cwd: string, env: Record<string, string>, cols: number, rows: number): void {
    this.send({ op: 'spawn', id, cmd: argv, cwd, env, cols, rows });
  }
  /**
   * Queue an attach. `beforeSend` runs when this attach actually goes out (not
   * when it is queued) — the caller uses it to wipe the session's mirror right
   * before its replay arrives, rather than blanking a session that is still
   * waiting its turn.
   */
  attach(id: string, beforeSend?: () => void): void {
    this.attachQueue.push({ id, beforeSend });
    this.pumpAttach();
  }

  private pumpAttach(): void {
    if (this.attachInFlight || !this.connected) return;
    const next = this.attachQueue.shift();
    if (!next) return;
    this.attachInFlight = {
      id: next.id,
      hard: setTimeout(() => this.finishAttach(), this.attachHardMs),
      quiet: setTimeout(() => this.finishAttach(), this.attachQuietMs),
    };
    this.attachInFlight.hard.unref?.();
    this.attachInFlight.quiet.unref?.();
    try {
      next.beforeSend?.();
    } catch (err) {
      console.error('[argusd] pre-attach hook threw for', next.id, err);
    }
    this.send({ op: 'attach', id: next.id });
  }

  /** Replay bytes are still arriving — hold the queue a little longer. */
  private armAttachQuiet(): void {
    const inflight = this.attachInFlight;
    if (!inflight) return;
    clearTimeout(inflight.quiet);
    inflight.quiet = setTimeout(() => this.finishAttach(), this.attachQuietMs);
    inflight.quiet.unref?.();
  }

  private finishAttach(): void {
    const inflight = this.attachInFlight;
    if (!inflight) return;
    clearTimeout(inflight.hard);
    clearTimeout(inflight.quiet);
    this.attachInFlight = null;
    this.pumpAttach();
  }

  private clearAttachState(): void {
    if (this.attachInFlight) {
      clearTimeout(this.attachInFlight.hard);
      clearTimeout(this.attachInFlight.quiet);
      this.attachInFlight = null;
    }
    this.attachQueue = [];
  }
  writeSession(id: string, data: string): void {
    this.writeFrame(KIND_DATA, id, Buffer.from(data, 'utf8'));
  }
  resize(id: string, cols: number, rows: number): void {
    this.send({ op: 'resize', id, cols, rows });
  }
  kill(id: string): void {
    this.send({ op: 'kill', id });
  }
  /**
   * Resolve once the daemon reports this session's exit, or after timeoutMs.
   * Register it BEFORE sending the kill: exit frames are keyed by session id
   * alone, so a restart must drain the old agent's exit before a replacement
   * pty subscribes to the same id (else the stale exit marks it dead).
   */
  waitForExit(id: string, timeoutMs: number): Promise<void> {
    if (!this.connected) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.removeListener(`exit:${id}`, done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.once(`exit:${id}`, done);
    });
  }
  killAll(): void {
    this.send({ op: 'killAll' });
  }
  list(): Promise<string[]> {
    return new Promise((resolve) => {
      this.listPending.push(resolve);
      this.send({ op: 'list' });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearAttachState();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      this.sock.removeAllListeners();
      this.sock.destroy();
      this.sock = null;
    }
    this.connected = false;
    this.removeAllListeners();
  }
}

interface IDisposable {
  dispose(): void;
}

/**
 * Adapts a daemon-backed session to the node-pty IPty surface SessionManager
 * consumes (onData/onExit/write/resize/kill), so swapping the backend is nearly
 * invisible to SessionManager. Decodes pty bytes with a StringDecoder to avoid
 * splitting a multibyte sequence across frames.
 */
export class DaemonPty {
  private decoder = new StringDecoder('utf8');
  private dataCbs = new Set<(data: string) => void>();
  private exitCbs = new Set<(e: { exitCode: number }) => void>();
  private onDataBytes = (buf: Buffer) => {
    const s = this.decoder.write(buf);
    if (s) for (const cb of this.dataCbs) cb(s);
  };
  private onExitCode = (code: number) => {
    for (const cb of this.exitCbs) cb({ exitCode: code });
  };

  constructor(private client: DaemonClient, private id: string) {
    client.on(`data:${id}`, this.onDataBytes);
    client.on(`exit:${id}`, this.onExitCode);
  }

  onData(cb: (data: string) => void): IDisposable {
    this.dataCbs.add(cb);
    return { dispose: () => this.dataCbs.delete(cb) };
  }
  onExit(cb: (e: { exitCode: number }) => void): IDisposable {
    this.exitCbs.add(cb);
    return { dispose: () => this.exitCbs.delete(cb) };
  }
  write(data: string): void {
    this.client.writeSession(this.id, data);
  }
  resize(cols: number, rows: number): void {
    this.client.resize(this.id, cols, rows);
  }
  kill(): void {
    this.client.kill(this.id);
  }
  dispose(): void {
    this.client.removeListener(`data:${this.id}`, this.onDataBytes);
    this.client.removeListener(`exit:${this.id}`, this.onExitCode);
    this.dataCbs.clear();
    this.exitCbs.clear();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
