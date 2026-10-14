package main

import (
	"net"
	"strings"
	"testing"
	"time"
)

// One session flooding a consumer that has fallen behind must cost only that
// session: its live output is shed and the consumer is told to resync it, while
// the connection — and every other session's stream — stays up. The legacy
// shared outbox dropped the connection instead, and the reconnect re-attached
// (and replayed, and reparsed) every session.
func TestOverflowResyncsOnlyTheFloodingSession(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)
	if err := fc.writeControl(control{Op: "caps", Caps: []string{capResync}}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond) // caps lands before the flood starts

	spawnFirehose(t, fc, "hose")
	if err := fc.writeControl(control{
		Op: "spawn", ID: "calm",
		Cmd: []string{"/bin/sh", "-c", "sleep 1.5; printf CALM-MARK; sleep 60"},
	}); err != nil {
		t.Fatal(err)
	}

	// Stall: the hose's queued live output passes its budget within moments.
	deadline := time.Now().Add(5 * time.Second)
	var client *framedConn
	for time.Now().Before(deadline) {
		d.mu.Lock()
		client = d.client
		d.mu.Unlock()
		if client != nil && client.resyncs.Load() > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if client == nil || client.resyncs.Load() == 0 {
		t.Fatal("flooding session was never switched to resync")
	}
	if !client.isResyncing("hose") || client.isResyncing("calm") {
		t.Fatal("resync must target the flooding session only")
	}

	// Drain again: the resync notice arrives, the calm session's output still
	// streams, and the connection was never dropped.
	sawResync, sawCalm := false, false
	var calm strings.Builder
	deadline = time.Now().Add(10 * time.Second)
	for !(sawResync && sawCalm) {
		_ = c.SetReadDeadline(deadline)
		f, err := readFrame(c)
		if err != nil {
			t.Fatalf("connection lost (resync=%v calm=%v): %v", sawResync, sawCalm, err)
		}
		switch f.kind {
		case kindControl:
			if ctl, _ := f.control(); ctl.Op == "resync" && ctl.ID == "hose" {
				sawResync = true
			}
		case kindData:
			if f.id == "calm" {
				calm.Write(f.data)
				sawCalm = strings.Contains(calm.String(), "CALM-MARK")
			}
		}
	}
	d.mu.Lock()
	same := d.client == client
	d.mu.Unlock()
	if !same {
		t.Fatal("the connection was dropped and replaced")
	}

	// Re-attach ends the episode: replay, ack, then live output again.
	if err := fc.writeControl(control{Op: "attach", ID: "hose"}); err != nil {
		t.Fatal(err)
	}
	acked := false
	liveAfterAck := 0
	deadline = time.Now().Add(20 * time.Second)
	for liveAfterAck < 4 {
		_ = c.SetReadDeadline(deadline)
		f, err := readFrame(c)
		if err != nil {
			t.Fatalf("after re-attach (acked=%v): %v", acked, err)
		}
		if f.kind == kindControl {
			if ctl, _ := f.control(); ctl.Op == "attached" && ctl.ID == "hose" {
				acked = true
			}
		} else if acked && f.id == "hose" {
			liveAfterAck++
		}
	}
}

// A consumer that never announced capResync would ignore a resync notice and
// leave the session frozen forever, so it keeps the legacy contract: shared
// budget, overflow drops the connection, no notice is ever sent.
func TestLegacyConsumerNeverGetsResync(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)
	spawnFirehose(t, fc, "hose")

	deadline := time.Now().Add(20 * time.Second)
	var last *framedConn
	for time.Now().Before(deadline) {
		d.mu.Lock()
		cl := d.client
		d.mu.Unlock()
		if cl == nil {
			break
		}
		last = cl
		time.Sleep(20 * time.Millisecond)
	}
	if last == nil {
		t.Fatal("never saw the connection")
	}
	if n := last.resyncs.Load(); n != 0 {
		t.Fatalf("legacy consumer got %d resync notices", n)
	}
	d.mu.Lock()
	gone := d.client == nil
	d.mu.Unlock()
	if !gone {
		t.Fatal("legacy consumer's overflow should drop the connection")
	}
}

// Unit: the per-session budget sheds one session's queued live frames and
// leaves other sessions' frames — and control frames — in place.
func TestStartResyncDiscardsOnlyThatSession(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	// Never read b: everything stays queued (the writer blocks on the pipe).
	fc := newClientConn(a, func() int { return 2 })
	defer fc.drop()
	fc.enableResync()

	chunk := make([]byte, 32<<10)
	if err := fc.writeData("other", chunk); err != nil {
		t.Fatal(err)
	}
	var err error
	for i := 0; i < 64 && err == nil; i++ {
		err = fc.writeData("hose", chunk)
	}
	if err != errSessionResync {
		t.Fatalf("hose never hit its budget: %v", err)
	}
	if err := fc.writeData("hose", chunk); err != errSessionResync {
		t.Fatalf("live output must stay suppressed until re-attach, got %v", err)
	}
	if err := fc.writeData("other", chunk); err != nil {
		t.Fatalf("other session must keep streaming: %v", err)
	}
	fc.mu.Lock()
	hoseQueued := fc.liveQueued["hose"]
	otherQueued := fc.liveQueued["other"]
	fc.mu.Unlock()
	if hoseQueued != 0 {
		t.Fatalf("hose still has %d live bytes queued after resync", hoseQueued)
	}
	if otherQueued == 0 {
		t.Fatal("other session's frames were discarded")
	}

	fc.resumeLive("hose")
	if err := fc.writeData("hose", chunk); err != nil {
		t.Fatalf("live output must resume after re-attach: %v", err)
	}
}
