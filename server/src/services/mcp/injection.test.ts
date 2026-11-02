import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, readFileSync, statSync } from 'fs';
import { computeMcpToken, verifyMcpToken, writeMcpConfig, MCP_SERVER_NAME } from './injection.js';
import { computeSignalToken } from '../agentSignals/token.js';

test('MCP token is bound to the session and separate from the signal token', () => {
  const t = computeMcpToken('s3cret', 'sess-A');
  assert.equal(verifyMcpToken('s3cret', 'sess-A', t), true);
  assert.equal(verifyMcpToken('s3cret', 'sess-B', t), false, 'not valid for another session');
  assert.equal(verifyMcpToken('other', 'sess-A', t), false, 'not valid under another secret');
  assert.equal(verifyMcpToken('s3cret', 'sess-A', computeSignalToken('s3cret', 'sess-A')), false, 'a signal token is not an MCP token');
});

test('writeMcpConfig writes a private per-session config and returns the flag pair', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-mcp-'));
  const flags = writeMcpConfig(dir, '5403', 's3cret', 'sess-A');
  assert.equal(flags[0], '--mcp-config');
  assert.equal(flags[1], path.join(dir, 'mcp', 'sess-A.json'));
  assert.equal(statSync(flags[1]!).mode & 0o777, 0o600);
  const cfg = JSON.parse(readFileSync(flags[1]!, 'utf8'));
  const server = cfg.mcpServers[MCP_SERVER_NAME];
  assert.equal(server.type, 'http');
  assert.equal(server.url, 'http://127.0.0.1:5403/mcp');
  assert.equal(server.headers.Authorization, `Bearer ${computeMcpToken('s3cret', 'sess-A')}`);
  assert.equal(server.headers['X-Argus-Session'], 'sess-A');
});
