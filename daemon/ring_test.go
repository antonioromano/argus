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
	r.write([]byte("xyz"))          // partial
	r.write([]byte("1234567"))      // large → keeps trailing 5
	if got := r.snapshot(); !bytes.Equal(got, []byte("34567")) {
		t.Fatalf("got %q, want %q", got, "34567")
	}
}

func TestRingEmpty(t *testing.T) {
	if got := newRing(8).snapshot(); len(got) != 0 {
		t.Fatalf("empty ring snapshot should be empty, got %q", got)
	}
}
