import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRpc, RPC, SUPPORTED_PROTOCOL_VERSIONS, ToolError, textResult, type ToolDef } from './protocol.js';

const tools: ToolDef<string>[] = [
  { name: 'echo', title: 'Echo', description: 'd', inputSchema: { type: 'object' }, run: async (args, ctx) => textResult(`${ctx}:${String(args.x)}`) },
  { name: 'nope', title: 'Nope', description: 'd', inputSchema: { type: 'object' }, run: async () => { throw new ToolError('denied'); } },
  { name: 'boom', title: 'Boom', description: 'd', inputSchema: { type: 'object' }, run: async () => { throw new Error('secret detail'); } },
];
const call = (msg: unknown) => handleRpc(msg, tools, 'caller');

test('initialize echoes a supported protocol version, else offers the newest', async () => {
  const ok = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal((ok?.result as any).protocolVersion, '2025-03-26');
  assert.deepEqual((ok?.result as any).capabilities, { tools: { listChanged: false } });
  const other = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal((other?.result as any).protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
});

test('notifications and client responses get no reply', async () => {
  assert.equal(await call({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await call({ jsonrpc: '2.0', id: 3, result: {} }), null);
});

test('tools/list lists every tool with its schema', async () => {
  const r = await call({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.deepEqual((r?.result as any).tools.map((t: any) => t.name), ['echo', 'nope', 'boom']);
  assert.ok((r?.result as any).tools[0].inputSchema);
});

test('tools/call runs the tool with the caller context', async () => {
  const r = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { x: 7 } } });
  assert.deepEqual((r?.result as any).content, [{ type: 'text', text: 'caller:7' }]);
});

test('a ToolError is a tool result with isError, other errors stay opaque', async () => {
  const denied = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } });
  assert.equal((denied?.result as any).isError, true);
  assert.equal((denied?.result as any).content[0].text, 'denied');
  const boom = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'boom' } });
  assert.equal(boom?.error?.code, RPC.internal);
  assert.doesNotMatch(boom!.error!.message, /secret/);
});

test('malformed messages are JSON-RPC errors', async () => {
  assert.equal((await call([{ jsonrpc: '2.0', id: 1, method: 'ping' }]))?.error?.code, RPC.invalidRequest);
  assert.equal((await call({ id: 1, method: 'ping' }))?.error?.code, RPC.invalidRequest);
  assert.equal((await call({ jsonrpc: '2.0', id: 8, method: 'resources/list' }))?.error?.code, RPC.methodNotFound);
  assert.equal((await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'missing' } }))?.error?.code, RPC.invalidParams);
  assert.equal((await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'echo', arguments: [1] } }))?.error?.code, RPC.invalidParams);
  assert.deepEqual((await call({ jsonrpc: '2.0', id: 11, method: 'ping' }))?.result, {});
});
