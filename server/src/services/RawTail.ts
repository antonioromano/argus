/**
 * The last ~`cap` characters of a session's raw pty stream, kept only for the
 * diagnostics dump (escape bytes the mirror has already interpreted away).
 *
 * Replaces the old `outputBuffer += data; slice(-100_000)`, which copied up to
 * 100KB per pty chunk. Chunks are stored by reference and whole chunks are
 * dropped from the front, so push is O(1) amortised and the only string
 * building happens when someone actually reads the tail.
 */
export class RawTail {
  private chunks: string[] = [];
  private length = 0;

  constructor(private readonly cap: number) {}

  push(data: string): void {
    if (!data) return;
    this.chunks.push(data);
    this.length += data.length;
    // Drop whole chunks while what remains still covers the cap.
    while (this.chunks.length > 1 && this.length - (this.chunks[0] as string).length >= this.cap) {
      this.length -= (this.chunks.shift() as string).length;
    }
  }

  /** Total characters held (may exceed `cap` by at most one chunk). */
  get size(): number {
    return this.length;
  }

  /** The last `max` characters (default: the cap). */
  tail(max: number = this.cap): string {
    const joined = this.chunks.join('');
    return joined.length > max ? joined.slice(-max) : joined;
  }

  clear(): void {
    this.chunks = [];
    this.length = 0;
  }
}
