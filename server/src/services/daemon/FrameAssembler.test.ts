import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameAssembler } from './DaemonClient.js';

function frame(body: Buffer): Buffer {
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(body.length, 0);
  return Buffer.concat([hdr, body]);
}

function drain(a: FrameAssembler): Buffer[] {
  const out: Buffer[] = [];
  for (let f = a.next(); f; f = a.next()) out.push(Buffer.from(f));
  return out;
}

test('FrameAssembler: frames survive any chunking of the stream', () => {
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let round = 0; round < 200; round++) {
    const bodies: Buffer[] = [];
    for (let i = 0; i < 1 + rnd(8); i++) {
      const b = Buffer.alloc(rnd(3) === 0 ? 0 : rnd(5000));
      for (let j = 0; j < b.length; j++) b[j] = rnd(256);
      bodies.push(b);
    }
    const stream = Buffer.concat(bodies.map(frame));
    const a = new FrameAssembler();
    const got: Buffer[] = [];
    // Split at random points, including 1-byte slivers inside a header.
    for (let off = 0; off < stream.length; ) {
      const n = Math.min(stream.length - off, 1 + rnd(rnd(2) ? 3 : 4096));
      a.push(stream.subarray(off, off + n));
      off += n;
      got.push(...drain(a));
    }
    assert.equal(got.length, bodies.length, `round ${round}: frame count`);
    got.forEach((g, i) => assert.ok(g.equals(bodies[i]!), `round ${round}: frame ${i} bytes`));
    assert.equal(a.length, 0, 'nothing left buffered');
  }
});

test('FrameAssembler: holds a partial frame until its last byte arrives', () => {
  const body = Buffer.from('hello world');
  const s = frame(body);
  const a = new FrameAssembler();
  a.push(s.subarray(0, 2));
  assert.equal(a.next(), null, 'half a header is not a frame');
  a.push(s.subarray(2, 9));
  assert.equal(a.next(), null, 'header + partial body is not a frame');
  a.push(s.subarray(9));
  assert.equal(a.next()?.toString(), 'hello world');
  assert.equal(a.next(), null);
});

// The reason this class exists: re-concatenating the pending buffer on every
// socket chunk made a large replay frame cost O(chunks²) bytes of copying.
test('FrameAssembler: a 2MB frame in 64KB chunks copies each byte once', () => {
  const body = Buffer.alloc(2 << 20, 7);
  const s = frame(body);
  const a = new FrameAssembler();
  let calls = 0;
  const realCopy = Buffer.prototype.copy;
  Buffer.prototype.copy = function (this: Buffer, ...args: Parameters<Buffer['copy']>) {
    calls++;
    return realCopy.apply(this, args);
  } as Buffer['copy'];
  try {
    for (let off = 0; off < s.length; off += 64 << 10) {
      a.push(s.subarray(off, off + (64 << 10)));
      if (off + (64 << 10) < s.length) assert.equal(a.next(), null);
    }
    const f = a.next();
    assert.ok(f && f.length === body.length && f.equals(body));
  } finally {
    Buffer.prototype.copy = realCopy;
  }
  // One copy per chunk (33 chunks) into the assembled frame — not one per
  // chunk *per pending byte*.
  assert.ok(calls <= 40, `expected ~33 chunk copies, saw ${calls}`);
});
