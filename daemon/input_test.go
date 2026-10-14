package main

import (
	"bytes"
	"testing"
	"time"
)

// waitSession polls until the daemon's table holds id.
func waitSession(t *testing.T, d *daemon, id string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		d.mu.Lock()
		_, ok := d.sessions[id]
		d.mu.Unlock()
		if ok {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

// An agent that stops reading its stdin fills the pty input queue, and a pty
// write blocks from then on. Input used to be written on the connection's read
// goroutine, so one deaf session froze typing, resizes and spawns for every
// other session. Each session now has its own input writer.
func TestDeafSessionDoesNotBlockOtherInput(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	// Raw mode + no reader: the input queue fills and stays full.
	if err := fc.writeControl(control{
		Op: "spawn", ID: "deaf",
		Cmd: []string{"/bin/sh", "-c", "stty raw -echo; sleep 600"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := fc.writeControl(control{
		Op: "spawn", ID: "echo",
		Cmd: []string{"/bin/sh", "-c", "stty -echo; while read l; do printf 'GOT:%s\\n' \"$l\"; done"},
	}); err != nil {
		t.Fatal(err)
	}
	if !waitSession(t, d, "deaf", 3*time.Second) || !waitSession(t, d, "echo", 3*time.Second) {
		t.Fatal("sessions never spawned")
	}
	time.Sleep(200 * time.Millisecond) // let stty run

	// Far more than any pty input queue holds, then input for the other
	// session. Written from a goroutine: against a daemon whose read loop is
	// stuck in a pty write, these socket writes block too.
	go func() {
		junk := bytes.Repeat([]byte("x"), 64<<10)
		for i := 0; i < 8; i++ {
			if fc.writeData("deaf", junk) != nil {
				return
			}
		}
		_ = fc.writeData("echo", []byte("ping\n"))
	}()
	waitForData(t, c, "echo", "GOT:ping", 5*time.Second)

	// The control path is not stuck either.
	if err := fc.writeControl(control{Op: "spawn", ID: "late", Cmd: []string{"/bin/sh", "-c", "sleep 30"}}); err != nil {
		t.Fatal(err)
	}
	if !waitSession(t, d, "late", 3*time.Second) {
		t.Fatal("spawn stuck behind a deaf session's input")
	}
}

// A session's input queue is bounded: input for a session that never drains it
// is dropped past the cap rather than held without limit.
func TestSessionInputQueueIsBounded(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)
	if err := fc.writeControl(control{
		Op: "spawn", ID: "deaf",
		Cmd: []string{"/bin/sh", "-c", "stty raw -echo; sleep 600"},
	}); err != nil {
		t.Fatal(err)
	}
	if !waitSession(t, d, "deaf", 3*time.Second) {
		t.Fatal("session never spawned")
	}
	time.Sleep(200 * time.Millisecond)
	d.mu.Lock()
	s := d.sessions["deaf"]
	d.mu.Unlock()

	chunk := bytes.Repeat([]byte("y"), 64<<10)
	for i := 0; i < 64; i++ { // 4MB, well past the cap
		s.write(chunk)
	}
	if q := s.inQueued.Load(); q > maxSessionInputBytes {
		t.Fatalf("input queue holds %d bytes, cap is %d", q, maxSessionInputBytes)
	}
	if s.inDropped.Load() == 0 {
		t.Fatal("expected input past the cap to be dropped")
	}
}

// Attach replay waits on a slow consumer for up to replayWriteTimeout per
// chunk. It used to run on the connection's read goroutine, so while one
// session's backlog was pacing out, no input, resize or spawn was processed for
// any session.
func TestReplayDoesNotBlockControlPath(t *testing.T) {
	d := startTestDaemon(t)
	c1 := dial(t, d)
	fc1 := newFramedConn(c1)
	expectHello(t, c1)
	ids := []string{"b0", "b1", "b2", "b3", "b4", "b5"}
	for _, id := range ids {
		spawnRingFiller(t, fc1, id)
	}
	waitRingsFull(t, d, ids, 30*time.Second)
	_ = c1.Close()
	time.Sleep(100 * time.Millisecond)

	c2 := dial(t, d)
	fc2 := newFramedConn(c2)
	expectHello(t, c2)
	for _, id := range ids {
		if err := fc2.writeControl(control{Op: "attach", ID: id}); err != nil {
			t.Fatal(err)
		}
	}
	// Don't read: the replay backs up behind us and has to wait for room.
	time.Sleep(500 * time.Millisecond)
	if err := fc2.writeControl(control{Op: "spawn", ID: "late", Cmd: []string{"/bin/sh", "-c", "sleep 30"}}); err != nil {
		t.Fatal(err)
	}
	if !waitSession(t, d, "late", 3*time.Second) {
		t.Fatal("spawn stuck behind a paced attach replay")
	}
}
