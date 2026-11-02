/**
 * Minimal MCP server over Streamable HTTP (F10), stateless: every POST carries
 * one JSON-RPC message and gets one JSON response (no SSE stream, no session
 * id). That is a valid server per the spec — a server may answer a request
 * with `application/json` — and all an MCP client needs for tools.
 *
 * Hand-rolled instead of `@modelcontextprotocol/sdk` to keep a new root
 * dependency (and its bundling invariants, see check:deps) out of the server:
 * the surface is initialize, ping, tools/list and tools/call.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'argus', title: 'Argus', version: '1' } as const;

/** JSON-RPC error codes used here. */
export const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef<C> {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  /** Throw ToolError for a caller-facing failure (returned as isError, not a protocol error). */
  run(args: Record<string, unknown>, ctx: C): Promise<ToolResult>;
}

/** A failure the calling agent should read and act on (bad id, denied, …). */
export class ToolError extends Error {}

export const textResult = (text: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(structured ? { structuredContent: structured } : {}),
});

type Id = string | number;
export interface RpcResponse {
  jsonrpc: '2.0';
  id: Id | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const isId = (v: unknown): v is Id => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const fail = (id: Id | null, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * Handle one JSON-RPC message. Returns the response, or null for a
 * notification / client response (the HTTP layer answers those 202).
 */
export async function handleRpc<C>(msg: unknown, tools: readonly ToolDef<C>[], ctx: C): Promise<RpcResponse | null> {
  if (Array.isArray(msg)) return fail(null, RPC.invalidRequest, 'Batch requests are not supported');
  if (!msg || typeof msg !== 'object') return fail(null, RPC.invalidRequest, 'Invalid request');
  const m = msg as Record<string, unknown>;
  if (m.jsonrpc !== '2.0') return fail(isId(m.id) ? m.id : null, RPC.invalidRequest, 'Invalid request');
  // A notification (no id), or a response to a request we never send.
  if (!('id' in m) || m.method === undefined) return null;
  if (!isId(m.id)) return fail(null, RPC.invalidRequest, 'Invalid request id');
  const id = m.id;
  if (typeof m.method !== 'string') return fail(id, RPC.invalidRequest, 'Invalid method');
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const version = (SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(asked)
        ? (asked as string)
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Argus runs coding-agent sessions side by side. start_session asks the user to approve a new session ' +
            '(blocks until they decide); list_sessions / read_session show what every session is doing; ' +
            'send_input and stop_session work only on sessions you started.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0', id,
        result: {
          tools: tools.map((t) => ({
            name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
            ...(t.annotations ? { annotations: t.annotations } : {}),
          })),
        },
      };
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return fail(id, RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments ?? {};
      if (!args || typeof args !== 'object' || Array.isArray(args)) return fail(id, RPC.invalidParams, 'Arguments must be an object');
      try {
        return { jsonrpc: '2.0', id, result: await tool.run(args as Record<string, unknown>, ctx) };
      } catch (err) {
        if (err instanceof ToolError) return { jsonrpc: '2.0', id, result: { ...textResult(err.message), isError: true } };
        console.warn(`[mcp] ${tool.name} failed:`, err);
        return fail(id, RPC.internal, 'Internal error');
      }
    }
    default:
      return fail(id, RPC.methodNotFound, `Method not found: ${m.method}`);
  }
}
