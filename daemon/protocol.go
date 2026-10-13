package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// Wire framing: [uint32 BE bodyLen][body]. body[0] = kind, body[1] = idLen,
// body[2:2+idLen] = sessionId, body[2+idLen:] = payload.
//
//	kind 'C' → payload is JSON `control` (session id usually empty)
//	kind 'D' → payload is raw pty bytes for the tagged session (both directions:
//	           daemon→server is output, server→daemon is input)
const (
	kindControl = 'C'
	kindData    = 'D'
)

// Protocol version — bumped on any breaking frame/op change. The server compares
// it in the handshake and drains on mismatch (plan 2026-07-22-003).
const protocolVersion = 1

const maxFrame = 8 * 1024 * 1024 // guard against a corrupt length prefix

type control struct {
	Op       string            `json:"op"`
	ID       string            `json:"id,omitempty"`
	Cmd      []string          `json:"cmd,omitempty"`
	Cwd      string            `json:"cwd,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Cols     int               `json:"cols,omitempty"`
	Rows     int               `json:"rows,omitempty"`
	Code     int               `json:"code,omitempty"`
	Sessions []string          `json:"sessions,omitempty"`
	Version  int               `json:"version,omitempty"`
	Msg      string            `json:"msg,omitempty"`
	// Caps (op "caps", server→daemon): optional behaviours the consumer
	// understands. An older daemon ignores the op; an older server never sends
	// it, and keeps the legacy flow control below.
	Caps []string `json:"caps,omitempty"`
}

// capResync: the consumer handles {op:"resync", id} by re-attaching that
// session. Without it the daemon cannot shed one session's backlog, so it falls
// back to the legacy shared budget whose overflow drops the connection.
const capResync = "resync"

const (
	// Live (non-replay) output one session may have queued and unsent. Past
	// this the session — not the connection — is behind: its queued live frames
	// are discarded and the server is told to resync it. Kept BELOW the ring
	// capacity on purpose: the attach replay that follows covers the whole ring,
	// so it re-delivers every discarded byte and the client sees no gap.
	maxSessionLiveBytes = 1 << 20
	// Replay (attach backlog) bytes the outbox holds at once. Replay waits for
	// room under this rather than being dropped (see enqueueWait).
	maxReplayBytes = 2 << 20
	// Charged per queued frame on top of its bytes, so a flood of tiny frames
	// is bounded by the same budgets as a few big ones.
	frameOverhead = 64
	// A single socket write that can't complete in this long means the consumer
	// is wedged, not busy.
	defaultWriteTimeout = 15 * time.Second
	// How often a paced write re-checks for outbox room.
	outboxPollInterval = 2 * time.Millisecond
	// Upper bound on one batched socket write (writev of queued frames).
	maxWriteBatch = 1 << 20
	// Shared outbox budget for a consumer that has not announced capResync
	// (the pre-flow-control behaviour: overflow drops the connection).
	legacyOutboxBytes = 8 << 20
)

// writeTimeout is a var so tests can shorten the wedge detector.
var writeTimeout = defaultWriteTimeout

var (
	errOutboxFull = errors.New("outbox full — consumer not draining")
	// errSessionResync: this session's live output is being discarded until the
	// server re-attaches it. Not a connection failure.
	errSessionResync = errors.New("session awaiting resync")
)

// outFrame is one encoded frame waiting for the writer.
type outFrame struct {
	buf  []byte
	id   string // session the frame belongs to ("" for control)
	live bool   // live pty output (droppable on per-session overflow)
	cost int64
}

// framedConn serializes all writes to a connection (many pty read-loop
// goroutines + control replies share one socket).
//
// Writes NEVER block the caller. A pty read loop that had to wait on the socket
// would hold up every other session sharing it, stalling the agents themselves
// and jamming the daemon's control path. Frames go into an outbox drained by one
// writer goroutine instead.
//
// Flow control is PER SESSION. A session whose queued live output passes
// maxSessionLiveBytes has those frames discarded and a {op:"resync", id} control
// frame queued in their place; further live output for it is dropped until the
// server re-attaches it (resumeLive), whose replay re-covers the gap from the
// ring. Every other session keeps streaming. The previous design had one shared
// 8MB budget whose overflow closed the whole connection — one busy session
// reattached every session, and each reattach replayed and reparsed a 2MB ring
// (a cascade that cost seconds of main-thread time in the app).
//
// A global safety cap sized to the session count remains: crossing it (only
// possible through a pathological flood of control frames) still drops the
// connection, as does a socket write that cannot complete in writeTimeout.
//
// Per-session resync is opt-in (capResync, announced by the consumer with
// op "caps"): a consumer that never announced it would ignore the notice and
// leave the session frozen, so it keeps the legacy shared 8MB budget.
type framedConn struct {
	w  io.Writer
	mu sync.Mutex // guards w on the synchronous path; the outbox on the async one

	// Async path — set by newClientConn, nil for plain io.Writer wrapping.
	conn         net.Conn
	sessionCount func() int
	cond         *sync.Cond
	q            []*outFrame
	queued       int64            // total cost queued
	replayQueued int64            // cost of queued replay frames
	liveQueued   map[string]int64 // per-session cost of queued live frames
	resyncing    map[string]bool  // sessions whose live output is suppressed
	resyncs      atomic.Int64     // resync notices issued (tests/diagnostics)
	resyncOK     atomic.Bool      // consumer announced capResync
	dead         chan struct{}
	once         sync.Once
}

// newFramedConn wraps a plain writer with synchronous framing (test helpers and
// the client side of the protocol, where there is no fan-in to protect).
func newFramedConn(w io.Writer) *framedConn { return &framedConn{w: w} }

// newClientConn wraps the active server connection and starts its writer
// goroutine. sessionCount sizes the global safety cap (nil → treated as 1).
func newClientConn(c net.Conn, sessionCount func() int) *framedConn {
	fc := &framedConn{
		w:            c,
		conn:         c,
		sessionCount: sessionCount,
		liveQueued:   map[string]int64{},
		resyncing:    map[string]bool{},
		dead:         make(chan struct{}),
	}
	fc.cond = sync.NewCond(&fc.mu)
	go fc.writeLoop()
	return fc
}

// globalCap bounds everything queued: every session at its live cap, the replay
// window, plus one more session's worth of headroom for control frames. Called
// WITHOUT c.mu held: sessionCount takes the daemon lock, and the two locks are
// never nested.
func (c *framedConn) globalCap() int64 {
	if !c.resyncOK.Load() {
		return legacyOutboxBytes
	}
	n := 1
	if c.sessionCount != nil {
		if k := c.sessionCount(); k > n {
			n = k
		}
	}
	return int64(n+1)*maxSessionLiveBytes + maxReplayBytes
}

// isDead reports whether the connection has been dropped. A synchronous
// (test/client) wrapper is never dead.
func (c *framedConn) isDead() bool {
	if c.dead == nil {
		return false
	}
	select {
	case <-c.dead:
		return true
	default:
		return false
	}
}

func (c *framedConn) writeLoop() {
	var batch net.Buffers
	for {
		c.mu.Lock()
		for len(c.q) == 0 && !c.isDead() {
			c.cond.Wait()
		}
		if c.isDead() {
			c.mu.Unlock()
			return
		}
		// Take a batch of frames and release their budget as they leave the
		// queue: from here they belong to the socket, not the outbox.
		batch = batch[:0]
		size := 0
		taken := 0
		for _, f := range c.q {
			if taken > 0 && size+len(f.buf) > maxWriteBatch {
				break
			}
			batch = append(batch, f.buf)
			size += len(f.buf)
			taken++
			c.release(f)
		}
		clear(c.q[:taken])
		c.q = c.q[taken:]
		c.mu.Unlock()

		_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		out := batch // WriteTo consumes its receiver; keep batch's backing array
		_, err := out.WriteTo(c.conn)
		clear(batch) // don't pin sent frames until the slots are reused
		if err != nil {
			c.drop()
			return
		}
	}
}

// release returns a frame's cost to the budgets. Caller holds c.mu.
func (c *framedConn) release(f *outFrame) {
	c.queued -= f.cost
	if f.live {
		if v := c.liveQueued[f.id] - f.cost; v > 0 {
			c.liveQueued[f.id] = v
		} else {
			delete(c.liveQueued, f.id)
		}
	} else if f.id != "" {
		c.replayQueued -= f.cost
	}
}

// drop closes the connection and the outbox. Idempotent: the writer goroutine,
// an overflowing producer and the read loop can all reach it.
func (c *framedConn) drop() {
	c.once.Do(func() {
		close(c.dead)
		if c.conn != nil {
			_ = c.conn.Close()
		}
		if c.cond != nil {
			c.mu.Lock()
			c.q = nil
			c.cond.Broadcast()
			c.mu.Unlock()
		}
	})
}

// push appends a frame. Caller holds c.mu.
func (c *framedConn) push(f *outFrame) {
	c.q = append(c.q, f)
	c.queued += f.cost
	if f.live {
		c.liveQueued[f.id] += f.cost
	} else if f.id != "" {
		c.replayQueued += f.cost
	}
	c.cond.Signal()
}

// enqueueControl queues a non-session frame, never blocking.
func (c *framedConn) enqueueControl(buf []byte) error {
	if c.cond == nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		_, err := c.w.Write(buf)
		return err
	}
	f := &outFrame{buf: buf, cost: int64(len(buf)) + frameOverhead}
	limit := c.globalCap()
	c.mu.Lock()
	if c.isDead() {
		c.mu.Unlock()
		return errOutboxFull
	}
	if c.queued+f.cost > limit {
		c.mu.Unlock()
		c.drop()
		return errOutboxFull
	}
	c.push(f)
	c.mu.Unlock()
	return nil
}

// enqueueLive queues one session's live output, never blocking. A session past
// its live budget is switched to resync instead of costing the connection.
func (c *framedConn) enqueueLive(id string, data []byte) error {
	if c.cond == nil {
		return c.writeFrameSync(kindData, id, data)
	}
	buf, err := encodeFrame(kindData, id, data)
	if err != nil {
		return err
	}
	cost := int64(len(buf)) + frameOverhead
	resyncOK := c.resyncOK.Load()
	limit := c.globalCap()
	c.mu.Lock()
	if c.isDead() {
		c.mu.Unlock()
		return errOutboxFull
	}
	if c.resyncing[id] {
		c.mu.Unlock()
		return errSessionResync
	}
	if resyncOK && c.liveQueued[id]+cost > maxSessionLiveBytes {
		c.startResyncLocked(id)
		c.mu.Unlock()
		return errSessionResync
	}
	if c.queued+cost > limit {
		c.mu.Unlock()
		c.drop()
		return errOutboxFull
	}
	c.push(&outFrame{buf: buf, id: id, live: true, cost: cost})
	c.mu.Unlock()
	return nil
}

// startResyncLocked discards the session's queued live frames, suppresses its
// live output and queues the resync notice. Caller holds c.mu.
func (c *framedConn) startResyncLocked(id string) {
	c.resyncing[id] = true
	kept := c.q[:0]
	for _, f := range c.q {
		if f.live && f.id == id {
			c.release(f)
			continue
		}
		kept = append(kept, f)
	}
	clear(c.q[len(kept):])
	c.q = kept
	c.resyncs.Add(1)
	if b, err := json.Marshal(control{Op: "resync", ID: id}); err == nil {
		if buf, err := encodeFrame(kindControl, "", b); err == nil {
			// Bypasses the global cap: it is tiny, one per session per episode,
			// and losing it would leave the session frozen.
			c.push(&outFrame{buf: buf, cost: int64(len(buf)) + frameOverhead})
		}
	}
}

// enableResync records that the consumer handles per-session resync.
func (c *framedConn) enableResync() { c.resyncOK.Store(true) }

// resumeLive ends a session's resync episode: the caller is about to replay its
// ring (attach), after which live output flows again.
func (c *framedConn) resumeLive(id string) {
	if c.cond == nil {
		return
	}
	c.mu.Lock()
	delete(c.resyncing, id)
	c.mu.Unlock()
}

// isResyncing reports whether a session's live output is suppressed.
func (c *framedConn) isResyncing(id string) bool {
	if c.cond == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.resyncing[id]
}

// enqueueWait hands a replay frame to the writer, WAITING for replay-window
// room instead of dropping it.
//
// Live output is droppable (the ring re-covers it); attach replay is not — it
// IS the ring, and dropping it leaves a restored terminal blank. It is a
// bounded, one-shot backlog produced off the connection's read loop, so waiting
// costs nothing but this consumer's own throughput. The timeout still
// distinguishes slow from gone: a consumer that frees no room at all within it
// is wedged, and we drop it.
func (c *framedConn) enqueueWait(id string, buf []byte, timeout time.Duration) error {
	if c.cond == nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		_, err := c.w.Write(buf)
		return err
	}
	f := &outFrame{buf: buf, id: id, cost: int64(len(buf)) + frameOverhead}
	deadline := time.Now().Add(timeout)
	for {
		c.mu.Lock()
		if c.isDead() {
			c.mu.Unlock()
			return errOutboxFull
		}
		// An empty replay window always admits one frame, however large.
		if c.replayQueued == 0 || c.replayQueued+f.cost <= maxReplayBytes {
			c.push(f)
			c.mu.Unlock()
			return nil
		}
		c.mu.Unlock()
		if time.Now().After(deadline) {
			c.drop()
			return errOutboxFull
		}
		time.Sleep(outboxPollInterval)
	}
}

// writeDataPaced is writeData for backlog replay: same frame, paced enqueue.
func (c *framedConn) writeDataPaced(id string, data []byte, timeout time.Duration) error {
	buf, err := encodeFrame(kindData, id, data)
	if err != nil {
		return err
	}
	return c.enqueueWait(id, buf, timeout)
}

func (c *framedConn) writeControl(ctl control) error {
	b, err := json.Marshal(ctl)
	if err != nil {
		return err
	}
	return c.writeFrame(kindControl, "", b)
}

// writeData queues live pty output for a session (droppable; see enqueueLive).
func (c *framedConn) writeData(id string, data []byte) error {
	return c.enqueueLive(id, data)
}

func (c *framedConn) writeFrame(kind byte, id string, payload []byte) error {
	buf, err := encodeFrame(kind, id, payload)
	if err != nil {
		return err
	}
	return c.enqueueControl(buf)
}

func (c *framedConn) writeFrameSync(kind byte, id string, payload []byte) error {
	buf, err := encodeFrame(kind, id, payload)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = c.w.Write(buf)
	return err
}

// encodeFrame builds one complete frame in a single buffer, so the writer can
// never separate a header from its body.
func encodeFrame(kind byte, id string, payload []byte) ([]byte, error) {
	if len(id) > 255 {
		return nil, fmt.Errorf("session id too long: %d", len(id))
	}
	buf := make([]byte, 4+2+len(id)+len(payload))
	binary.BigEndian.PutUint32(buf[:4], uint32(2+len(id)+len(payload)))
	buf[4] = kind
	buf[5] = byte(len(id))
	copy(buf[6:], id)
	copy(buf[6+len(id):], payload)
	return buf, nil
}

type frame struct {
	kind byte
	id   string
	data []byte
}

func readFrame(r io.Reader) (frame, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return frame{}, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n < 2 || n > maxFrame {
		return frame{}, fmt.Errorf("bad frame length %d", n)
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return frame{}, err
	}
	idLen := int(body[1])
	if 2+idLen > len(body) {
		return frame{}, fmt.Errorf("frame id length %d exceeds body %d", idLen, len(body))
	}
	return frame{kind: body[0], id: string(body[2 : 2+idLen]), data: body[2+idLen:]}, nil
}

func (f frame) control() (control, error) {
	var c control
	err := json.Unmarshal(f.data, &c)
	return c, err
}
