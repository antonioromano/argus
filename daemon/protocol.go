package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"sync"
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

// framedConn serializes all writes to a connection (many pty read-loop
// goroutines + control replies share one socket).
type framedConn struct {
	w  io.Writer
	mu sync.Mutex
}

func newFramedConn(w io.Writer) *framedConn { return &framedConn{w: w} }

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
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))

	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := c.w.Write(body)
	return err
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
