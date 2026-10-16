import { open, stat } from 'fs/promises';

/**
 * Tolerant incremental reader of an append-only JSONL file: the shared core of
 * the Claude transcript tailer and the Codex rollout tailer.
 *
 * Reads only the bytes appended since the last poll: it keeps the byte offset
 * of the last complete line and carries an unterminated tail over to the next
 * poll, so a line flushed in two writes is parsed once, whole. A file that
 * shrank or changed inode was rewritten, so the subclass state is cleared and
 * the file is read again from byte 0. Lines longer than MAX_LINE_BYTES are
 * skipped instead of buffered forever.
 */

/** Minimal fs surface, injectable for tests. */
export interface TranscriptFs {
  stat(path: string): Promise<{ size: number; ino: number }>;
  read(path: string, position: number, length: number): Promise<Buffer>;
}

export const nodeTranscriptFs: TranscriptFs = {
  async stat(path) {
    const s = await stat(path);
    return { size: s.size, ino: s.ino };
  },
  async read(path, position, length) {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, position);
      return bytesRead === length ? buf : buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  },
};

const READ_CHUNK = 1024 * 1024;
/** An unterminated line longer than this is dropped rather than buffered forever. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;

export abstract class JsonlTailer {
  readonly path: string;
  protected offset = 0;
  protected ino?: number;
  /** Bytes of the unterminated line after `offset`, in arrival order. Kept as
   *  pieces and joined once the newline arrives, so a multi-MB line costs one
   *  copy instead of one per chunk. */
  private pieces: Buffer[] = [];
  private pendingBytes = 0;
  private dropping = false;

  constructor(path: string, protected fs: TranscriptFs = nodeTranscriptFs) {
    this.path = path;
  }

  /** Apply one complete line. True when it changed the subclass state. */
  protected abstract line(text: string): boolean;
  /** Forget the subclass state (the file was rewritten). True when there was any. */
  protected abstract clear(): boolean;

  /** Read whatever was appended since the last poll. Resolves true when the state changed. */
  async poll(): Promise<boolean> {
    let st: { size: number; ino: number };
    try {
      st = await this.fs.stat(this.path);
    } catch {
      return false; // not written yet, or deleted — keep what we have
    }
    let changed = false;
    const readFrom = this.offset + this.pendingBytes;
    if ((this.ino !== undefined && st.ino !== this.ino) || st.size < readFrom) {
      changed = this.reset();
    }
    this.ino = st.ino;

    let pos = this.offset + this.pendingBytes;
    while (pos < st.size) {
      const len = Math.min(READ_CHUNK, st.size - pos);
      const chunk = await this.fs.read(this.path, pos, len);
      if (chunk.length === 0) break;
      pos += chunk.length;
      if (this.consume(chunk)) changed = true;
    }
    return changed;
  }

  private reset(): boolean {
    this.offset = 0;
    this.pieces = [];
    this.pendingBytes = 0;
    this.dropping = false;
    return this.clear();
  }

  private consume(chunk: Buffer): boolean {
    let changed = false;
    let start = 0;
    // Only the new chunk is searched for newlines; earlier bytes of the pending
    // line were already searched when they arrived.
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      if (nl === -1) break;
      const tail = chunk.subarray(start, nl);
      if (this.dropping) {
        this.dropping = false; // end of an oversized line: resume with the next one
      } else {
        const lineBuf = this.pieces.length ? Buffer.concat([...this.pieces, tail]) : tail;
        if (lineBuf.length > 0 && this.line(lineBuf.toString('utf8'))) changed = true;
      }
      this.offset += this.pendingBytes + (nl + 1 - start);
      this.pieces = [];
      this.pendingBytes = 0;
      start = nl + 1;
    }
    const rest = chunk.subarray(start);
    if (rest.length > 0) {
      if (this.dropping) {
        this.offset += rest.length; // still inside an oversized line: skip it
      } else {
        // Copy so the retained tail doesn't pin the whole chunk's memory.
        this.pieces.push(Buffer.from(rest));
        this.pendingBytes += rest.length;
        if (this.pendingBytes > MAX_LINE_BYTES) {
          this.offset += this.pendingBytes;
          this.pieces = [];
          this.pendingBytes = 0;
          this.dropping = true;
        }
      }
    }
    return changed;
  }
}
