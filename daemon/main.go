// argusd — a minimal pty-host daemon that owns agent ptys and outlives the
// Argus app, replacing tmux as the process-survival layer (plan 2026-07-22-003).
// It is NOT a multiplexer: one consumer (the Argus server) at a time, no
// windows/panes/copy-mode, bytes flow pty↔socket untouched.
package main

import (
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const idleTimeout = 5 * time.Minute

type daemon struct {
	socketPath string
	pidPath    string

	mu           sync.Mutex
	sessions     map[string]*session
	client       *framedConn
	lastActivity time.Time
}

func main() {
	log.SetPrefix("[argusd] ")
	log.SetFlags(log.Ltime)

	socketPath := defaultSocketPath()
	if len(os.Args) > 1 && os.Args[1] != "" {
		socketPath = os.Args[1]
	}

	d := &daemon{
		socketPath:   socketPath,
		pidPath:      socketPath + ".pid",
		sessions:     map[string]*session{},
		lastActivity: time.Now(),
	}

	ln, err := d.listen()
	if err != nil {
		log.Fatalf("listen %s: %v", socketPath, err)
	}
	defer d.cleanup()
	d.writePid()

	// SIGTERM/SIGINT → terminate every agent and exit (the "Quit & Stop All"
	// signal path, and orderly shutdown).
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigs
		log.Println("signal received — killing all sessions and exiting")
		d.killAll()
		d.cleanup()
		os.Exit(0)
	}()

	go d.idleLoop()

	log.Printf("listening on %s (pid %d)", socketPath, os.Getpid())
	d.serve(ln)
}

// serve is the accept loop: single-consumer, refusing a second connection while
// one is active. Extracted from main so tests can drive it without os.Exit.
func (d *daemon) serve(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		d.mu.Lock()
		busy := d.client != nil
		d.mu.Unlock()
		if busy {
			// Single-consumer: a second server must be refused, not silently
			// multiplexed. Drop the new connection immediately.
			log.Println("refusing second connection (single-consumer)")
			_ = conn.Close()
			continue
		}
		go d.handleConn(conn)
	}
}

func (d *daemon) listen() (net.Listener, error) {
	ln, err := net.Listen("unix", d.socketPath)
	if err == nil {
		return ln, nil
	}
	// Address in use: is a live daemon answering, or is this a stale socket?
	if c, derr := net.DialTimeout("unix", d.socketPath, 500*time.Millisecond); derr == nil {
		_ = c.Close()
		log.Println("another argusd is already live on this socket — exiting")
		os.Exit(0)
	}
	// Stale — remove and retry once.
	_ = os.Remove(d.socketPath)
	return net.Listen("unix", d.socketPath)
}

func (d *daemon) writePid() {
	_ = os.MkdirAll(filepath.Dir(d.pidPath), 0o755)
	_ = os.WriteFile(d.pidPath, []byte(itoa(os.Getpid())), 0o644)
}

func (d *daemon) cleanup() {
	_ = os.Remove(d.socketPath)
	_ = os.Remove(d.pidPath)
}

// handleConn serves the single active server connection: handshake, then a frame
// read loop. On disconnect, sessions survive (unsubscribed) — the whole point.
func (d *daemon) handleConn(conn net.Conn) {
	fc := newFramedConn(conn)
	d.mu.Lock()
	d.client = fc
	d.lastActivity = time.Now()
	d.mu.Unlock()

	_ = fc.writeControl(control{Op: "hello", Version: protocolVersion})
	log.Println("server connected")

	defer func() {
		_ = conn.Close()
		d.mu.Lock()
		d.client = nil
		d.lastActivity = time.Now()
		for _, s := range d.sessions {
			s.mu.Lock()
			s.subscribed = false
			s.mu.Unlock()
		}
		d.mu.Unlock()
		log.Println("server disconnected — sessions kept alive")
	}()

	for {
		f, err := readFrame(conn)
		if err != nil {
			return
		}
		if f.kind == kindData {
			d.mu.Lock()
			s := d.sessions[f.id]
			d.mu.Unlock()
			if s != nil {
				s.write(f.data)
			}
			continue
		}
		c, err := f.control()
		if err != nil {
			continue
		}
		d.handleControl(fc, c)
	}
}

func (d *daemon) handleControl(fc *framedConn, c control) {
	d.mu.Lock()
	d.lastActivity = time.Now()
	d.mu.Unlock()

	switch c.Op {
	case "spawn":
		s, err := startSession(c.ID, c.Cmd, c.Cwd, c.Env, c.Cols, c.Rows)
		if err != nil {
			_ = fc.writeControl(control{Op: "error", ID: c.ID, Msg: err.Error()})
			return
		}
		d.mu.Lock()
		d.sessions[c.ID] = s
		d.mu.Unlock()
		go d.readLoop(s)
		_ = fc.writeControl(control{Op: "spawned", ID: c.ID})

	case "attach":
		d.mu.Lock()
		s := d.sessions[c.ID]
		d.mu.Unlock()
		if s == nil {
			_ = fc.writeControl(control{Op: "error", ID: c.ID, Msg: "no such session"})
			return
		}
		// Hold the session lock so the read loop can't interleave a live frame
		// between the backlog and the subscribe — the client gets ring-then-live
		// in order.
		s.mu.Lock()
		snap := s.ring.snapshot()
		if len(snap) > 0 {
			_ = fc.writeData(s.id, snap)
		}
		s.subscribed = true
		s.mu.Unlock()

	case "write":
		d.mu.Lock()
		s := d.sessions[c.ID]
		d.mu.Unlock()
		if s != nil && c.Msg != "" {
			s.write([]byte(c.Msg))
		}

	case "resize":
		d.mu.Lock()
		s := d.sessions[c.ID]
		d.mu.Unlock()
		if s != nil {
			s.resize(c.Cols, c.Rows)
		}

	case "kill":
		d.mu.Lock()
		s := d.sessions[c.ID]
		d.mu.Unlock()
		if s != nil {
			s.kill()
		}

	case "list":
		d.mu.Lock()
		ids := make([]string, 0, len(d.sessions))
		for id := range d.sessions {
			ids = append(ids, id)
		}
		d.mu.Unlock()
		_ = fc.writeControl(control{Op: "list", Sessions: ids})

	case "killAll":
		d.killAll()
		d.cleanup()
		os.Exit(0)

	case "ping":
		_ = fc.writeControl(control{Op: "pong", Version: protocolVersion})
	}
}

// readLoop pumps one session's pty output into its ring and (when subscribed) to
// the active client, until the process exits.
func (d *daemon) readLoop(s *session) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			s.mu.Lock()
			s.ring.write(chunk)
			sub := s.subscribed
			var c *framedConn
			if sub {
				d.mu.Lock()
				c = d.client
				d.mu.Unlock()
			}
			if c != nil {
				_ = c.writeData(s.id, chunk)
			}
			s.mu.Unlock()
		}
		if err != nil {
			break
		}
	}
	_ = s.cmd.Wait()
	code := 0
	if s.cmd.ProcessState != nil {
		code = s.cmd.ProcessState.ExitCode()
	}
	d.mu.Lock()
	delete(d.sessions, s.id)
	c := d.client
	d.lastActivity = time.Now()
	d.mu.Unlock()
	if c != nil {
		_ = c.writeControl(control{Op: "exit", ID: s.id, Code: code})
	}
	log.Printf("session %s exited (code %d)", s.id, code)
}

func (d *daemon) killAll() {
	d.mu.Lock()
	all := make([]*session, 0, len(d.sessions))
	for _, s := range d.sessions {
		all = append(all, s)
	}
	d.mu.Unlock()
	for _, s := range all {
		s.kill()
	}
}

func (d *daemon) idleLoop() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		d.mu.Lock()
		idle := len(d.sessions) == 0 && d.client == nil && time.Since(d.lastActivity) > idleTimeout
		d.mu.Unlock()
		if idle {
			log.Println("idle with no sessions and no client — exiting")
			d.cleanup()
			os.Exit(0)
		}
	}
}

func defaultSocketPath() string {
	label := os.Getenv("ARGUS_DAEMON_SOCKET")
	if label == "" {
		label = "argus"
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.TempDir()
	}
	return filepath.Join(home, ".argus", "argusd-"+label+".sock")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
