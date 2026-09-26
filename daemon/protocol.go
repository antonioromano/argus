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
//   kind 'C' → payload is JSON `control` (session id usually empty)
//   kind 'D' → payload is raw pty bytes for the tagged session (both directions:
//              daemon→server is output, server→daemon is input)
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
}

const (
	// Bytes of un-sent output the daemon is willing to hold for one consumer.
	// Past this the consumer is not slow, it is gone: we drop the connection
	// rather than grow without bound. ~2 full session rings.
	maxOutboxBytes = 8 << 20
	// Frames the outbox can hold regardless of size, so a flood of tiny frames
	// can't outrun the writer either.
	maxOutboxFrames = 8192
	// A single socket write that can't complete in this long means the consumer
	// is wedged, not busy.
	writeTimeout = 15 * time.Second
	// How often a paced write re-checks for outbox room. Coarse on purpose: this
	// runs on the control path, where a couple of milliseconds of latency per
	// chunk is invisible next to the socket write it is waiting for.
	outboxPollInterval = 2 * time.Millisecond
)

var errOutboxFull = errors.New("outbox full — consumer not draining")

// framedConn serializes all writes to a connection (many pty read-loop
// goroutines + control replies share one socket).
//
// Writes NEVER block the caller. A pty read loop that had to wait on the socket
// would hold its session lock while it waited, and — because every session
// shares this one connection — every other session's read loop would pile up
// behind it, stalling the agents themselves and jamming the daemon's control
// path (spawn/attach/resize/kill) daemon-wide. Instead frames go into a bounded
// outbox drained by one writer goroutine; if the consumer stops draining, the
// outbox fills and we close the connection. Sessions survive that close, so the
// server reconnects and re-attaches, and each session's ring replays the gap.
type framedConn struct {
	w  io.Writer
	mu sync.Mutex // guards w on the synchronous path (no outbox)

	// Async path — set by newClientConn, nil for plain io.Writer wrapping.
	conn   net.Conn
	q      chan []byte
	queued atomic.Int64
	dead   chan struct{}
	once   sync.Once
}

// newFramedConn wraps a plain writer with synchronous framing (test helpers and
// the client side of the protocol, where there is no fan-in to protect).
func newFramedConn(w io.Writer) *framedConn { return &framedConn{w: w} }

// newClientConn wraps the active server connection and starts its writer
// goroutine. All daemon→server frames go through the bounded outbox.
func newClientConn(c net.Conn) *framedConn {
	fc := &framedConn{
		w:    c,
		conn: c,
		q:    make(chan []byte, maxOutboxFrames),
		dead: make(chan struct{}),
	}
	go fc.writeLoop()
	return fc
}

func (c *framedConn) writeLoop() {
	for {
		select {
		case <-c.dead:
			return
		case buf := <-c.q:
			c.queued.Add(-int64(len(buf)))
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if _, err := c.conn.Write(buf); err != nil {
				c.drop()
				return
			}
		}
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
	})
}

// enqueue hands one encoded frame to the writer, never blocking.
func (c *framedConn) enqueue(buf []byte) error {
	if c.q == nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		_, err := c.w.Write(buf)
		return err
	}
	select {
	case <-c.dead:
		return errOutboxFull
	default:
	}
	if c.queued.Load()+int64(len(buf)) > maxOutboxBytes {
		c.drop()
		return errOutboxFull
	}
	select {
	case c.q <- buf:
		c.queued.Add(int64(len(buf)))
		return nil
	default:
		c.drop()
		return errOutboxFull
	}
}

// enqueueWait hands a frame to the writer, WAITING for outbox room instead of
// declaring the consumer dead when the outbox is full.
//
// The non-blocking enqueue above is right for live output: a consumer that has
// stopped draining must not cost unbounded memory, and a session read loop must
// never block. Attach replay is the opposite case. It is a bounded, one-shot
// backlog that the consumer *needs* — dropping it leaves a restored terminal
// permanently blank — and it is produced on the connection's control goroutine,
// where waiting costs nothing but this consumer's own throughput. Waiting turns
// "consumer is behind" into backpressure rather than a dropped connection.
//
// The timeout still distinguishes slow from gone: a consumer that frees no room
// at all within it is wedged, and we drop it exactly as before.
func (c *framedConn) enqueueWait(buf []byte, timeout time.Duration) error {
	if c.q == nil {
		return c.enqueue(buf)
	}
	deadline := time.Now().Add(timeout)
	for {
		select {
		case <-c.dead:
			return errOutboxFull
		default:
		}
		if c.queued.Load()+int64(len(buf)) <= maxOutboxBytes {
			select {
			case c.q <- buf:
				c.queued.Add(int64(len(buf)))
				return nil
			default:
			}
		}
		if time.Now().After(deadline) {
			c.drop()
			return errOutboxFull
		}
		time.Sleep(outboxPollInterval)
	}
}

// writeDataPaced is writeData for backlog replay: same frame, paced enqueue.
func (c *framedConn) writeDataPaced(id string, data []byte, timeout time.Duration) error {
	if len(id) > 255 {
		return fmt.Errorf("session id too long: %d", len(id))
	}
	body := make([]byte, 0, 2+len(id)+len(data))
	body = append(body, kindData, byte(len(id)))
	body = append(body, id...)
	body = append(body, data...)
	buf := make([]byte, 4+len(body))
	binary.BigEndian.PutUint32(buf[:4], uint32(len(body)))
	copy(buf[4:], body)
	return c.enqueueWait(buf, timeout)
}

func (c *framedConn) writeControl(ctl control) error {
	b, err := json.Marshal(ctl)
	if err != nil {
		return err
	}
	return c.writeFrame(kindControl, "", b)
}

func (c *framedConn) writeData(id string, data []byte) error {
	return c.writeFrame(kindData, id, data)
}

func (c *framedConn) writeFrame(kind byte, id string, payload []byte) error {
	if len(id) > 255 {
		return fmt.Errorf("session id too long: %d", len(id))
	}
	body := make([]byte, 0, 2+len(id)+len(payload))
	body = append(body, kind, byte(len(id)))
	body = append(body, id...)
	body = append(body, payload...)

	// One buffer, one write: the outbox hands the writer a complete frame, so a
	// header can never be separated from its body by a concurrent producer.
	buf := make([]byte, 4+len(body))
	binary.BigEndian.PutUint32(buf[:4], uint32(len(body)))
	copy(buf[4:], body)
	return c.enqueue(buf)
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
