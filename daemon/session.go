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

// spawnEnv builds the agent's environment: the daemon's own process env (PATH,
// HOME, …) as the base, with the server-supplied per-session vars overlaid, plus
// a guaranteed UTF-8 locale on the AGENT process itself — no client-side locale
// dependency (plan 003 R3; contrast the tmux path where the client's env decided
// the downgrade). Starting from os.Environ() is load-bearing: without it the
// agent would lose PATH and fail to exec.
func spawnEnv(env map[string]string) []string {
	merged := map[string]string{}
	for _, kv := range os.Environ() {
		if i := indexByte(kv, '='); i >= 0 {
			merged[kv[:i]] = kv[i+1:]
		}
	}
	for k, v := range env {
		merged[k] = v
	}
	utf8 := utf8Locale(merged["LC_ALL"]) || utf8Locale(merged["LC_CTYPE"]) || utf8Locale(merged["LANG"])
	if !utf8 {
		merged["LANG"] = "en_US.UTF-8"
		merged["LC_ALL"] = "en_US.UTF-8"
	}
	if merged["TERM"] == "" {
		merged["TERM"] = "xterm-256color"
	}
	out := make([]string, 0, len(merged))
	for k, v := range merged {
		out = append(out, k+"="+v)
	}
	return out
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
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
