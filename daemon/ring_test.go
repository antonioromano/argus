package main

import (
	"bytes"
	"testing"
)

func TestRingUnderCapacity(t *testing.T) {
	r := newRing(16)
	r.write([]byte("abc"))
	r.write([]byte("def"))
	if got := r.snapshot(); !bytes.Equal(got, []byte("abcdef")) {
		t.Fatalf("got %q, want %q", got, "abcdef")
	}
}

func TestRingExactCapacity(t *testing.T) {
	r := newRing(6)
	r.write([]byte("abcdef"))
	if got := r.snapshot(); !bytes.Equal(got, []byte("abcdef")) {
		t.Fatalf("got %q, want %q", got, "abcdef")
	}
}

func TestRingWraparoundManySmallWrites(t *testing.T) {
	r := newRing(4)
	for _, s := range []string{"a", "b", "c", "d", "e", "f"} {
		r.write([]byte(s))
	}
	// Only the last 4 bytes survive, in order.
	if got := r.snapshot(); !bytes.Equal(got, []byte("cdef")) {
		t.Fatalf("got %q, want %q", got, "cdef")
	}
}

func TestRingSingleLargeWriteKeepsTail(t *testing.T) {
	r := newRing(4)
	r.write([]byte("0123456789"))
	if got := r.snapshot(); !bytes.Equal(got, []byte("6789")) {
		t.Fatalf("got %q, want %q", got, "6789")
	}
}

func TestRingWraparoundThenLargeWrite(t *testing.T) {
	r := newRing(5)
	r.write([]byte("xyz"))     // partial
	r.write([]byte("1234567")) // large → keeps trailing 5
	if got := r.snapshot(); !bytes.Equal(got, []byte("34567")) {
		t.Fatalf("got %q, want %q", got, "34567")
	}
}

func TestRingEmpty(t *testing.T) {
	if got := newRing(8).snapshot(); len(got) != 0 {
		t.Fatalf("empty ring snapshot should be empty, got %q", got)
	}
}

// from is what lets attach replay a ring in paced chunks: the producer keeps
// writing between chunks, so a position must survive its bytes being evicted.
func TestRingFromResumesAndClampsToOldest(t *testing.T) {
	r := newRing(8)
	r.write([]byte("abcdefgh"))

	mark := r.oldest()
	chunk, next := r.from(mark, 3)
	if string(chunk) != "abc" {
		t.Fatalf("first chunk = %q, want \"abc\"", chunk)
	}

	// The producer laps the reader: "abcdefgh" -> ring now holds "ijklmnop".
	r.write([]byte("ijklmnop"))
	chunk, next = r.from(next, 4)
	if string(chunk) != "ijkl" {
		t.Fatalf("after eviction chunk = %q, want the oldest bytes still held (\"ijkl\")", chunk)
	}
	chunk, next = r.from(next, 99)
	if string(chunk) != "mnop" {
		t.Fatalf("tail chunk = %q, want \"mnop\"", chunk)
	}
	if chunk, _ = r.from(next, 99); len(chunk) != 0 {
		t.Fatalf("caught up, but from returned %q", chunk)
	}
}

// naiveRing is the obvious byte-at-a-time model the ring must agree with.
type naiveRing struct {
	cap  int
	data []byte
	all  uint64
}

func (n *naiveRing) write(p []byte) {
	n.all += uint64(len(p))
	n.data = append(n.data, p...)
	if len(n.data) > n.cap {
		n.data = append([]byte(nil), n.data[len(n.data)-n.cap:]...)
	}
}

// Every write size relative to the capacity (tiny, straddling the wrap, exact,
// oversized) must leave the ring holding exactly the trailing bytes, and from()
// must read any window of them back unchanged.
func TestRingMatchesNaiveModel(t *testing.T) {
	for _, capacity := range []int{1, 2, 7, 64, 1000} {
		r := newRing(capacity)
		m := &naiveRing{cap: capacity}
		seed := uint32(capacity*2654435761 + 1)
		next := func() uint32 { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed }
		for step := 0; step < 2000; step++ {
			p := make([]byte, int(next()%uint32(capacity*2+2)))
			for i := range p {
				p[i] = byte(next())
			}
			r.write(p)
			m.write(p)
			if got := r.snapshot(); !bytes.Equal(got, m.data) {
				t.Fatalf("cap %d step %d: snapshot %v, want %v", capacity, step, got, m.data)
			}
			if r.written != m.all {
				t.Fatalf("cap %d: written %d, want %d", capacity, r.written, m.all)
			}
			// Read back a random window through from().
			if len(m.data) > 0 {
				off := int(next() % uint32(len(m.data)))
				max := int(next()%uint32(len(m.data))) + 1
				chunk, pos := r.from(r.oldest()+uint64(off), max)
				want := m.data[off:]
				if len(want) > max {
					want = want[:max]
				}
				if !bytes.Equal(chunk, want) || pos != r.oldest()+uint64(off+len(want)) {
					t.Fatalf("cap %d step %d: from(%d,%d) = %v @%d, want %v", capacity, step, off, max, chunk, pos, want)
				}
			}
		}
	}
}

// Pty reads arrive in chunks of up to 32KB into a 2MB ring; a full attach
// replays the ring in 256KB from() chunks.
func BenchmarkRingWrite32K(b *testing.B) {
	r := newRing(ringCapacity)
	p := bytes.Repeat([]byte("x"), 32<<10)
	b.SetBytes(int64(len(p)))
	for i := 0; i < b.N; i++ {
		r.write(p)
	}
}

func BenchmarkRingWriteSmall(b *testing.B) {
	r := newRing(ringCapacity)
	p := bytes.Repeat([]byte("x"), 100)
	b.SetBytes(int64(len(p)))
	for i := 0; i < b.N; i++ {
		r.write(p)
	}
}

func BenchmarkRingReplayFull(b *testing.B) {
	r := newRing(ringCapacity)
	r.write(bytes.Repeat([]byte("y"), ringCapacity+12345)) // saturated, wrapped
	r.write([]byte("wrap"))
	b.SetBytes(ringCapacity)
	for i := 0; i < b.N; i++ {
		mark := r.oldest()
		for {
			chunk, next := r.from(mark, replayChunkBytes)
			if len(chunk) == 0 {
				break
			}
			mark = next
		}
	}
}

func BenchmarkRingSnapshot(b *testing.B) {
	r := newRing(ringCapacity)
	r.write(bytes.Repeat([]byte("y"), ringCapacity+12345))
	b.SetBytes(ringCapacity)
	for i := 0; i < b.N; i++ {
		_ = r.snapshot()
	}
}
