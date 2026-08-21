package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// shortSock returns a unix socket path short enough for macOS's ~104-char
// sun_path limit (t.TempDir embeds the long test name and overflows it).
func shortSock(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "ad")
	if err != nil {
		t.Fatalf("mkdtemp: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return filepath.Join(dir, "s.sock")
}

// startTestDaemon spins a daemon on a temp socket and returns it plus a cleanup.
func startTestDaemon(t *testing.T) *daemon {
	t.Helper()
	sock := shortSock(t)
	d := &daemon{
		socketPath:   sock,
		pidPath:      sock + ".pid",
		sessions:     map[string]*session{},
		lastActivity: time.Now(),
	}
	ln, err := d.listen()
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go d.serve(ln)
	t.Cleanup(func() {
		d.killAll()
		_ = ln.Close()
	})
	return d
}

func dial(t *testing.T, d *daemon) net.Conn {
	t.Helper()
	c, err := net.DialTimeout("unix", d.socketPath, time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// expectHello reads the handshake frame.
func expectHello(t *testing.T, c net.Conn) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	f, err := readFrame(c)
	if err != nil {
		t.Fatalf("read hello: %v", err)
	}
	ctl, _ := f.control()
	if ctl.Op != "hello" || ctl.Version != protocolVersion {
		t.Fatalf("bad hello: %+v", ctl)
	}
}

// collectUntilExit reads frames until the session's exit control, returning the
// concatenated pty output and the exit code.
func collectUntilExit(t *testing.T, c net.Conn, id string, timeout time.Duration) (string, int) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var out strings.Builder
	for {
		_ = c.SetReadDeadline(deadline)
		f, err := readFrame(c)
		if err != nil {
			t.Fatalf("read: %v (out so far: %q)", err, out.String())
		}
		switch f.kind {
		case kindData:
			if f.id == id {
				out.Write(f.data)
			}
		case kindControl:
			ctl, _ := f.control()
			if ctl.Op == "exit" && ctl.ID == id {
				return out.String(), ctl.Code
			}
		}
	}
}

func TestSpawnEchoExit(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	if err := fc.writeControl(control{
		Op: "spawn", ID: "s1",
		Cmd: []string{"/bin/sh", "-c", "printf HELLO; exit 7"},
	}); err != nil {
		t.Fatal(err)
	}
	out, code := collectUntilExit(t, c, "s1", 5*time.Second)
	if !strings.Contains(out, "HELLO") {
		t.Fatalf("output missing HELLO: %q", out)
	}
	if code != 7 {
		t.Fatalf("exit code = %d, want 7", code)
	}
}

func TestReattachByteContinuity(t *testing.T) {
	d := startTestDaemon(t)

	// Connection 1: spawn a long-lived session that prints a marker, then idles.
	c1 := dial(t, d)
	fc1 := newFramedConn(c1)
	expectHello(t, c1)
	if err := fc1.writeControl(control{
		Op: "spawn", ID: "keep",
		Cmd: []string{"/bin/sh", "-c", "printf MARKER; sleep 30"},
	}); err != nil {
		t.Fatal(err)
	}
	// Read until we see the marker on the live stream.
	waitForData(t, c1, "keep", "MARKER", 5*time.Second)
	_ = c1.Close()

	// The daemon keeps the session alive across disconnect. Reconnect + attach:
	// the ring backlog must replay the marker.
	time.Sleep(100 * time.Millisecond)
	c2 := dial(t, d)
	fc2 := newFramedConn(c2)
	expectHello(t, c2)
	if err := fc2.writeControl(control{Op: "attach", ID: "keep"}); err != nil {
		t.Fatal(err)
	}
	waitForData(t, c2, "keep", "MARKER", 5*time.Second)

	// Session should still be listed (survived the disconnect).
	if err := fc2.writeControl(control{Op: "list"}); err != nil {
		t.Fatal(err)
	}
	if !listContains(t, c2, "keep", 2*time.Second) {
		t.Fatal("session did not survive disconnect")
	}
}

func TestDoubleAttachRefused(t *testing.T) {
	d := startTestDaemon(t)
	c1 := dial(t, d)
	expectHello(t, c1)

	// Second connection while the first is active → refused (closed, no hello).
	c2, err := net.DialTimeout("unix", d.socketPath, time.Second)
	if err != nil {
		t.Fatalf("dial2: %v", err)
	}
	defer c2.Close()
	_ = c2.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := readFrame(c2); err == nil {
		t.Fatal("second connection should have been refused, but it got a frame")
	}
}

func TestStaleSocketRecovery(t *testing.T) {
	sock := shortSock(t)
	// Leave a stale socket file with no listener behind it.
	if f, err := os.Create(sock); err == nil {
		_ = f.Close()
	}
	d := &daemon{socketPath: sock, pidPath: sock + ".pid", sessions: map[string]*session{}, lastActivity: time.Now()}
	ln, err := d.listen()
	if err != nil {
		t.Fatalf("listen over stale socket: %v", err)
	}
	defer ln.Close()
	go d.serve(ln)

	c := dial(t, d)
	expectHello(t, c)
}

// --- helpers ---

func waitForData(t *testing.T, c net.Conn, id, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var acc strings.Builder
	for {
		_ = c.SetReadDeadline(deadline)
		f, err := readFrame(c)
		if err != nil {
			t.Fatalf("waiting for %q: %v (got %q)", want, err, acc.String())
		}
		if f.kind == kindData && f.id == id {
			acc.Write(f.data)
			if strings.Contains(acc.String(), want) {
				return
			}
		}
	}
}

func listContains(t *testing.T, c net.Conn, id string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		_ = c.SetReadDeadline(deadline)
		f, err := readFrame(c)
		if err != nil {
			return false
		}
		if f.kind == kindControl {
			ctl, _ := f.control()
			if ctl.Op == "list" {
				for _, s := range ctl.Sessions {
					if s == id {
						return true
					}
				}
				return false
			}
		}
	}
}

// A restart is kill(id) immediately followed by spawn(id) on the SAME id. The
// old process dies asynchronously, so its read loop reaches its cleanup AFTER
// the replacement is already in the table — it must not evict the replacement
// (which left the fresh agent unreachable: writes went nowhere and the terminal
// looked hung) nor report an exit for it.
func TestRespawnSameIDSurvivesOldSessionExit(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	if err := fc.writeControl(control{
		Op: "spawn", ID: "s1",
		Cmd: []string{"/bin/sh", "-c", "printf FIRST; sleep 30"},
	}); err != nil {
		t.Fatal(err)
	}
	waitForData(t, c, "s1", "FIRST", 5*time.Second)

	if err := fc.writeControl(control{Op: "kill", ID: "s1"}); err != nil {
		t.Fatal(err)
	}
	if err := fc.writeControl(control{
		Op: "spawn", ID: "s1",
		Cmd: []string{"/bin/sh", "-c", "printf SECOND; sleep 30"},
	}); err != nil {
		t.Fatal(err)
	}
	waitForData(t, c, "s1", "SECOND", 5*time.Second)

	// Let the killed process's read loop run its cleanup.
	time.Sleep(500 * time.Millisecond)

	d.mu.Lock()
	live := d.sessions["s1"]
	d.mu.Unlock()
	if live == nil {
		t.Fatal("replacement session was evicted by the old session's exit")
	}
	if live.cmd.ProcessState != nil {
		t.Fatal("replacement session is not running")
	}
}

// Spawning over a live id (the shape a restart takes) must replace it: the old
// agent is killed, and its read loop must not evict the replacement from the
// table nor report an exit against its id.
func TestSpawnOverLiveIDReplacesIt(t *testing.T) {
	d := startTestDaemon(t)
	c := dial(t, d)
	fc := newFramedConn(c)
	expectHello(t, c)

	if err := fc.writeControl(control{
		Op: "spawn", ID: "s1",
		Cmd: []string{"/bin/sh", "-c", "printf FIRST; sleep 30"},
	}); err != nil {
		t.Fatal(err)
	}
	waitForData(t, c, "s1", "FIRST", 5*time.Second)

	d.mu.Lock()
	first := d.sessions["s1"]
	d.mu.Unlock()

	if err := fc.writeControl(control{
		Op: "spawn", ID: "s1",
		Cmd: []string{"/bin/sh", "-c", "printf SECOND; sleep 30"},
	}); err != nil {
		t.Fatal(err)
	}
	waitForData(t, c, "s1", "SECOND", 5*time.Second)

	// Let the displaced session's read loop reach its cleanup.
	time.Sleep(500 * time.Millisecond)

	d.mu.Lock()
	live := d.sessions["s1"]
	d.mu.Unlock()
	if live == nil {
		t.Fatal("replacement was evicted by the displaced session's exit")
	}
	if live == first {
		t.Fatal("spawn did not replace the live session")
	}
	if first.cmd.ProcessState == nil {
		t.Fatal("displaced agent was left running")
	}
}
