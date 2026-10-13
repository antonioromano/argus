import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskyFlagReason } from './riskyFlags.js';

test('riskyFlagReason matches on the name, case-insensitively, with or without a value', () => {
  assert.ok(riskyFlagReason('--MCP-CONFIG=x.json'));
  assert.ok(riskyFlagReason('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(riskyFlagReason('--yolo'));
  assert.equal(riskyFlagReason('--model=opus'), null);
  assert.equal(riskyFlagReason('--mcp-configs'), null);
});
