import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildReport, writeReport, DIAGNOSTICS_DIRNAME, type SessionDiagnosticsPayload } from './SessionDiagnostics.js';

function makePayload(overrides: Partial<SessionDiagnosticsPayload> = {}): SessionDiagnosticsPayload {
  return {
    session: {
      id: 'abcdef0123456789',
      name: 'My Session',
      folderPath: '/tmp/proj',
      status: 'waiting',
      createdAt: '2026-01-01T00:00:00.000Z',
      agentType: 'claude',
      flags: ['--foo'],
    },
    runtime: {
      persistent: true,
      tmuxName: 'argus-abc',
      cols: 120,
      rows: 30,
      suppressDonePromotion: false,
      donePromotionPending: true,
      hasUserInputSinceIdle: true,
      outputBufferBytes: 42,
      outputBufferCapBytes: 100_000,
      connectedClients: 2,
    },
    detector: {
      currentStatus: 'waiting',
      pendingStatus: null,
      feedCount: 3,
      classified: 'waiting',
      recentCursorStyle: false,
      cursor: { x: 4, y: 12 },
      lastReportedPrompt: 'Proceed?',
      extractedPrompt: 'Proceed?',
      visibleRows: ['line one', 'line two'],
      resizeAgeMs: 5000,
      timing: { IDLE_SETTLE_MS: 500 },
    },
    tmux: {
      tmuxName: 'argus-abc',
      paneDead: false,
      cursorX: 4,
      cursorY: 12,
      alternate: false,
      appMouse: false,
      sgr: true,
    },
    scrollback: 'scrollback body\nsecond line',
    rawTail: 'raw tail bytes',
    app: {
      nodeEnv: 'test',
      port: '5403',
      tmuxSocket: 'argus',
      pid: 1234,
      capturedAt: '2026-07-16T10:00:00.000Z',
    },
    ...overrides,
  };
}

test('buildReport produces markdown with a parseable JSON block that omits large blobs', () => {
  const { markdown, json } = buildReport(makePayload());
  assert.match(markdown, /# Argus session diagnostics — My Session/);
  assert.match(markdown, /## Full scrollback/);
  assert.match(markdown, /scrollback body/);
  assert.match(markdown, /raw tail bytes/);

  const parsed = JSON.parse(json);
  assert.equal(parsed.session.id, 'abcdef0123456789');
  assert.equal(parsed.detector.classified, 'waiting');
  assert.equal(parsed.runtime.connectedClients, 2);
  // Large text blobs are rendered as fenced code, NOT duplicated into the JSON.
  assert.equal(parsed.scrollback, undefined);
  assert.equal(parsed.rawTail, undefined);
});

test('buildReport handles a non-tmux session (null tmux/scrollback)', () => {
  const { markdown } = buildReport(makePayload({ tmux: null, scrollback: null }));
  assert.match(markdown, /Non-tmux session/);
  assert.match(markdown, /Unavailable/);
});

test('writeReport writes a file under diagnostics/ and prunes to the newest 50', async () => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'argus-diag-'));
  try {
    let lastPath = '';
    // Write 55 dumps; distinct capturedAt so filenames differ.
    for (let i = 0; i < 55; i++) {
      const ts = `2026-07-16T10-00-${String(i).padStart(2, '0')}-000Z`;
      const p = makePayload();
      lastPath = await writeReport(base, `# dump ${i}`, p.session, ts);
      // Nudge mtime forward so pruning-by-mtime is deterministic.
      const t = new Date(2026, 0, 1, 0, 0, i);
      await fs.promises.utimes(lastPath, t, t);
    }
    const dir = path.join(base, DIAGNOSTICS_DIRNAME);
    const files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 50, 'should keep only the newest 50 dumps');
    // The most recent write must survive the prune.
    assert.ok(fs.existsSync(lastPath));
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
});
