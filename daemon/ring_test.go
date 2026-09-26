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
