package main

import (
	"testing"
	"time"
)

// spawnRingFiller starts a session that prints more than the ring holds and then
// idles, so its backlog is a saturated ring the next attach must replay.
func spawnRingFiller(t *testing.T, fc *framedConn, id string) {
	t.Helper()
	if err := fc.writeControl(control{
		Op: "spawn", ID: id,
		Cmd: []string{"/bin/sh", "-c", "head -c 2500000 /dev/urandom | base64; sleep 60"},
	}); err != nil {
		t.Fatalf("spawn %s: %v", id, err)
	}
}

func waitRingsFull(t *testing.T, d *daemon, ids []string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		full := 0
		for _, id := range ids {
			d.mu.Lock()
			s := d.sessions[id]
			d.mu.Unlock()
			if s == nil {
				continue
			}
			s.mu.Lock()
			n := s.ring.len
			s.mu.Unlock()
			if n >= ringCapacity {
				full++
			}
		}
		if full == len(ids) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("sessions never filled their rings")
}

// The restore burst: an app restart re-attaches every session at once, and the
// combined backlog is many times the outbox. Replay is not droppable live
// output — dropping it leaves every restored terminal permanently blank (the
// mirror is empty and an idle agent sends nothing to repaint it), so the daemon
// must pace the replay against the consumer instead of overflowing its own
// outbox and closing the connection.
func TestBurstAttachReplaysEverySession(t *testing.T) {
	d := startTestDaemon(t)
	c1 := dial(t, d)
	fc1 := newFramedConn(c1)
	expectHello(t, c1)

	ids := []string{"r0", "r1", "r2", "r3", "r4", "r5"} // 6 x 2MB >> 8MB outbox
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
			t.Fatalf("attach %s: %v", id, err)
		}
	}

	// A deliberately slow consumer — the realistic shape of the Argus server,
	// which parses every replayed byte into a headless terminal before it reads
	// the next frame. The daemon must pace the replay against it rather than
	// declaring it dead.
	got := map[string]int{}
	acked := map[string]bool{}
	deadline := time.Now().Add(60 * time.Second)
	for len(acked) < len(ids) {
		_ = c2.SetReadDeadline(deadline)
		f, err := readFrame(c2)
		if err != nil {
			t.Fatalf("replay interrupted after %v bytes / %d acks: %v", got, len(acked), err)
		}
		switch f.kind {
		case kindData:
			got[f.id] += len(f.data)
			// ~5MB/s: the daemon must wait for this consumer, not outrun it.
			time.Sleep(time.Duration(len(f.data)/(64<<10)+1) * 10 * time.Millisecond)
		case kindControl:
			ctl, _ := f.control()
			if ctl.Op == "attached" {
				if got[ctl.ID] < ringCapacity {
					t.Fatalf("session %s acked with only %d of %d replay bytes", ctl.ID, got[ctl.ID], ringCapacity)
				}
				acked[ctl.ID] = true
			}
		}
	}
	for _, id := range ids {
		if got[id] < ringCapacity {
			t.Fatalf("session %s replayed %d bytes, want the whole %d-byte ring", id, got[id], ringCapacity)
		}
	}
}

// The ack is the client's "this session's backlog is done" signal — it lets the
// server attach sessions one at a time. It must arrive even when there is
// nothing to replay, or a restore would stall on the first empty session.
func TestAttachAcksWithEmptyRing(t *testing.T) {
	d := startTestDaemon(t)
	c1 := dial(t, d)
	fc1 := newFramedConn(c1)
	expectHello(t, c1)
	if err := fc1.writeControl(control{Op: "spawn", ID: "quiet", Cmd: []string{"/bin/sh", "-c", "sleep 60"}}); err != nil {
		t.Fatal(err)
	}
	// Let the spawn land, then drop the connection without any output produced.
	time.Sleep(300 * time.Millisecond)
	_ = c1.Close()
	time.Sleep(100 * time.Millisecond)

	c2 := dial(t, d)
	fc2 := newFramedConn(c2)
	expectHello(t, c2)
	if err := fc2.writeControl(control{Op: "attach", ID: "quiet"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		_ = c2.SetReadDeadline(deadline)
		f, err := readFrame(c2)
		if err != nil {
			t.Fatalf("no 'attached' ack for an empty ring: %v", err)
		}
		if f.kind == kindControl {
			if ctl, _ := f.control(); ctl.Op == "attached" && ctl.ID == "quiet" {
				return
			}
		}
	}
}
