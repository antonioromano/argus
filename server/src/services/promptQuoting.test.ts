import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PtyManager } from './PtyManager.js';
import { DaemonBackend } from './ptyBackend/DaemonBackend.js';

// A deep-link prompt reaches the agent through a shell on every spawn path.
// Each path must hand the prompt over verbatim — quotes, command substitution,
// backticks, newlines and `;` included — whether it leads or trails the flags.
const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-pq-'));
const CANARY = path.join(dir, 'pwned');
const PROMPT = `it's "$(touch ${CANARY})" \`touch ${CANARY}\`\nnext line; touch ${CANARY} & $HOME`;
const FORMAT = '<%s>';
const cases: Record<string, string[]> = {
  'prompt first': [FORMAT, PROMPT, '--model=opus', '--add-dir'],
  'prompt last': [FORMAT, '--model=opus', PROMPT],
};
const parse = (out: string) => [...out.replace(/\r\n/g, '\n').matchAll(/<([^>]*)>/g)].map((m) => m[1]);

test.after(() => rmSync(dir, { recursive: true, force: true }));

function withShell<T>(fn: () => T): T {
  const prev = process.env.SHELL;
  process.env.SHELL = '/bin/sh';
  try { return fn(); } finally { if (prev === undefined) delete process.env.SHELL; else process.env.SHELL = prev; }
}

for (const [name, flags] of Object.entries(cases)) {
  const expected = flags.slice(1);

  test(`tmux agent command round-trips the prompt (${name})`, () => {
    const cmd = withShell(() => (new PtyManager(dir) as any).buildAgentCommand('printf', flags) as string);
    // tmux runs the command string through /bin/sh -c; it then runs the login shell.
    const out = execFileSync('/bin/sh', ['-c', cmd], { encoding: 'utf-8' });
    assert.deepEqual(parse(out), expected);
    assert.equal(existsSync(CANARY), false);
  });

  test(`daemon argv round-trips the prompt (${name})`, () => {
    const backend = new DaemonBackend(path.join(dir, 's.sock'), '/nonexistent/argusd', 'test');
    let argv: string[] = [];
    (backend as any).client.spawn = (_id: string, a: string[]) => { argv = a; };   // capture, no daemon
    withShell(() => backend.spawn({ sessionId: 's1', folderPath: dir, command: 'printf', cols: 80, rows: 24, flags, extraEnv: {}, attachExisting: false }));
    const out = execFileSync(argv[0], argv.slice(1), { encoding: 'utf-8' });
    assert.deepEqual(parse(out), expected);
    assert.equal(existsSync(CANARY), false);
  });

  test(`direct pty spawn round-trips the prompt (${name})`, async () => {
    const p = withShell(() => new PtyManager(dir).spawn(dir, 'printf', 200, 40, flags));
    let out = '';
    p.onData((d) => { out += d; });
    await new Promise<void>((resolve) => p.onExit(() => resolve()));
    assert.deepEqual(parse(out), expected);
    assert.equal(existsSync(CANARY), false);
  });
}
