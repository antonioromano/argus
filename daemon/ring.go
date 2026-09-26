package main

// ringBuffer is a fixed-capacity byte ring holding the most recent pty output
// for a session. When a client (re)attaches, its snapshot seeds the server's
// TerminalMirror so replay has pre-attach history. Oldest bytes are overwritten
// once full — the daemon never reconstructs a screen, it just replays raw bytes
// (the mirror's parser tolerates a mid-escape start; see plan 2026-07-22-003).
type ringBuffer struct {
	buf   []byte
	start int // index of the oldest valid byte
	len   int // number of valid bytes (<= cap)
	// Total bytes ever written. The ring holds the byte range
	// [written-len, written), which lets a paced reader hold a stable position
	// (see from) while the producer keeps overwriting the oldest bytes.
	written uint64
}

func newRing(capacity int) *ringBuffer {
	if capacity < 1 {
		capacity = 1
	}
	return &ringBuffer{buf: make([]byte, capacity)}
}

func (r *ringBuffer) write(p []byte) {
	c := len(r.buf)
	r.written += uint64(len(p))
	// A write at least as large as the ring: keep only its trailing c bytes.
	if len(p) >= c {
		copy(r.buf, p[len(p)-c:])
		r.start = 0
		r.len = c
		return
	}
	for _, b := range p {
		idx := (r.start + r.len) % c
		r.buf[idx] = b
		if r.len < c {
			r.len++
		} else {
			r.start = (r.start + 1) % c // full: advance the oldest
		}
	}
}

// snapshot returns the valid bytes oldest-first, as a fresh copy.
func (r *ringBuffer) snapshot() []byte {
	c := len(r.buf)
	out := make([]byte, r.len)
	for i := 0; i < r.len; i++ {
		out[i] = r.buf[(r.start+i)%c]
	}
	return out
}

// from returns up to max bytes starting at absolute position mark, plus the
// position just past them. A mark the ring has already overwritten is clamped
// to the oldest byte it still holds — the replay then has a gap, which the
// mirror's parser tolerates the same way it tolerates starting mid-escape.
//
// Absolute positions (rather than a snapshot) are what let attach replay a
// saturated ring in paced chunks: the producer may overwrite bytes between two
// calls, and the reader still knows exactly where it is.
func (r *ringBuffer) from(mark uint64, max int) ([]byte, uint64) {
	if max <= 0 || r.len == 0 {
		return nil, mark
	}
	oldest := r.written - uint64(r.len)
	if mark < oldest {
		mark = oldest
	}
	avail := r.written - mark
	if avail == 0 {
		return nil, mark
	}
	n := int(avail)
	if n > max {
		n = max
	}
	c := len(r.buf)
	off := int(mark - oldest)
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		out[i] = r.buf[(r.start+off+i)%c]
	}
	return out, mark + uint64(n)
}

// oldest is the absolute position of the earliest byte the ring still holds:
// where an attach starts replaying.
func (r *ringBuffer) oldest() uint64 {
	return r.written - uint64(r.len)
}
