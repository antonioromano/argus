package main

import (
	"fmt"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

const ringCapacity = 2 * 1024 * 1024 // 2MB per-session backlog for mirror seeding

type session struct {
	id   string
	cmd  *exec.Cmd
	ptmx *os.File
	ring *ringBuffer

	mu         sync.Mutex
	subscribed bool // forward live output to the active client
	exited     bool
	code       int
}

func startSession(id string, argv []string, cwd string, env map[string]string, cols, rows int) (*session, error) {
	if len(argv) == 0 {
		return nil, fmt.Errorf("empty argv")
	}
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = spawnEnv(env)
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, err
	}
	return &session{id: id, cmd: cmd, ptmx: ptmx, ring: newRing(ringCapacity), subscribed: true}, nil
}

func (s *session) resize(cols, rows int) {
	if cols <= 0 || rows <= 0 {
		return
	}
	_ = pty.Setsize(s.ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (s *session) write(data []byte) {
	_, _ = s.ptmx.Write(data)
}

// kill terminates the agent and releases the pty. The read loop sees EOF and
// reports the exit.
func (s *session) kill() {
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	_ = s.ptmx.Close()
}

// spawnEnv flattens the server-supplied env and guarantees a UTF-8 locale on the
// AGENT process itself — no client-side locale dependency (plan 003 R3; contrast
// the tmux path where the client's env decided the downgrade).
func spawnEnv(env map[string]string) []string {
	if env == nil {
		env = map[string]string{}
	}
	has := func(k string) bool { _, ok := env[k]; return ok }
	utf8 := utf8Locale(env["LC_ALL"]) || utf8Locale(env["LC_CTYPE"]) || utf8Locale(env["LANG"])
	if !utf8 {
		env["LANG"] = "en_US.UTF-8"
		env["LC_ALL"] = "en_US.UTF-8"
	}
	if !has("TERM") {
		env["TERM"] = "xterm-256color"
	}
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}

func utf8Locale(v string) bool {
	for i := 0; i+4 <= len(v); i++ {
		s := v[i : i+4]
		if s == "UTF8" || s == "utf8" || s == "UTF-" || s == "utf-" {
			return true
		}
	}
	return false
}
