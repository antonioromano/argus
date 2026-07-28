package main

import (
	"net"
	"testing"
	"time"
)

// spawnFirehose starts a session that streams continuously, so the socket send
// buffer fills the moment the consumer stops reading. Each line carries a
// counter, so the ring's contents change even once it is saturated.
func spawnFirehose(t *testing.T, fc *framedConn, id string) {
	t.Helper()
	if err := fc.writeControl(control{
		Op: "spawn", ID: id,
		Cmd: []string{"/bin/sh", "-c", "i=0; while :; do i=$((i+1)); printf '%s line %d\\n' " + id + " $i; done"},
	}); err != nil {
		t.Fatalf("spawn %s: %v", id, err)
	}
}

// ringTail is a progress marker: the ring is a fixed-size window, so once it
// saturates only its *contents* keep moving. Identical tails across a interval
// mean the pty stopped being drained.
func ringTail(d *daemon, id string) string {
	d.mu.Lock()
	s := d.sessions[id]
	d.mu.Unlock()
	if s == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	snap := s.ring.snapshot()
	if len(snap) > 64 {
		snap = snap[len(snap)-64:]
	}
	return string(snap)
}

// A consumer that stops reading must never stop the daemon from draining ptys.
// Before the outbox existed, one blocked socket write held framedConn.mu (and
// the writing session's own lock), so every other session's read loop piled up
// behind it: agents stalled on their own pty writes and the daemon's control
// path jammed daemon-wide.
func TestStalledConsumerKeepsDrainingPtys(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	spawnFirehose(t, fc, "hose")
	spawnFirehose(t, fc, "other")

	// Let both sessions come up and start streaming into a consumer that reads.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if ringTail(d, "hose") != "" && ringTail(d, "other") != "" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if ringTail(d, "hose") == "" || ringTail(d, "other") == "" {
		t.Fatal("sessions never started streaming")
	}

	// Consumer stalls: we simply stop reading. The socket buffer fills within
	// milliseconds at this output rate.
	time.Sleep(300 * time.Millisecond)
	before := ringTail(d, "other")
	time.Sleep(700 * time.Millisecond)
	after := ringTail(d, "other")

	if after == before {
		t.Fatalf("pty draining stopped while the consumer was stalled (ring frozen at %q) — "+
			"a blocked socket write is holding the session lock", after)
	}
}

// A consumer that never drains must cost the daemon a bounded amount of memory
// and then lose its connection — not wedge every session forever. The sessions
// themselves must survive, so the server can reconnect and re-attach.
func TestStalledConsumerIsDroppedNotWedged(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	spawnFirehose(t, fc, "hose")

	// Never read again. The outbox fills, and the daemon drops us.
	dropped := false
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		d.mu.Lock()
		client := d.client
		d.mu.Unlock()
		if client == nil {
			dropped = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !dropped {
		t.Fatal("daemon kept a permanently stalled consumer attached instead of dropping it")
	}

	// The agent survives the drop and a fresh consumer can attach to it.
	d.mu.Lock()
	_, alive := d.sessions["hose"]
	d.mu.Unlock()
	if !alive {
		t.Fatal("dropping the stalled consumer killed the session")
	}

	c2, err := net.DialTimeout("unix", d.socketPath, 2*time.Second)
	if err != nil {
		t.Fatalf("reconnect dial: %v", err)
	}
	defer c2.Close()
	expectHello(t, c2)
	fc2 := newFramedConn(c2)
	if err := fc2.writeControl(control{Op: "attach", ID: "hose"}); err != nil {
		t.Fatalf("re-attach: %v", err)
	}
	waitForData(t, c2, "hose", "hose line", 5*time.Second)
}

// The control path must stay responsive while a session's output is backing up.
// A *slow* consumer (the realistic case: a busy Electron main thread) keeps the
// socket send buffer full without ever going away; spawning then writes a
// control reply, which used to queue behind a blocked data write on the shared
// connection mutex and hang the whole daemon.
func TestControlPathSurvivesBackedUpOutput(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	// A steady ~100KB/s producer: enough to fill the socket send buffer while we
	// aren't reading, nowhere near enough to overflow the outbox. This is the
	// realistic shape — a consumer that is behind, not one that is gone.
	if err := fc.writeControl(control{
		Op: "spawn", ID: "drip",
		Cmd: []string{"/bin/sh", "-c", "while :; do printf '%1024s' ''; sleep 0.01; done"},
	}); err != nil {
		t.Fatalf("spawn drip: %v", err)
	}
	time.Sleep(700 * time.Millisecond) // stop reading → socket send buffer fills

	if err := fc.writeControl(control{Op: "spawn", ID: "late", Cmd: []string{"/bin/sh", "-c", "sleep 30"}}); err != nil {
		t.Fatalf("late spawn: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		d.mu.Lock()
		_, ok := d.sessions["late"]
		d.mu.Unlock()
		if ok {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("daemon never processed a spawn while another session's output was backed up")
}
