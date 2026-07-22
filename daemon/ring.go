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
}

func newRing(capacity int) *ringBuffer {
	if capacity < 1 {
		capacity = 1
	}
	return &ringBuffer{buf: make([]byte, capacity)}
}

func (r *ringBuffer) write(p []byte) {
	c := len(r.buf)
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
