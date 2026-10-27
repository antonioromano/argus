import type { LaunchRequest, SessionInfo, ValidatedLaunch, ValidationResult } from '@argus/shared';
import { ToolError, textResult, type ToolDef } from './protocol.js';

/** The Argus session calling the MCP server (identified by its per-session token). */
export interface McpCaller {
  sessionId: string;
  name: string;
}

export type LaunchDecision = { ok: true; sessionId: string } | { ok: false; error: string };

/** What the tools need from the rest of Argus; index.ts wires the real ones. */
export interface McpHost {
  listSessions(): SessionInfo[];
  getSession(id: string): SessionInfo | undefined;
  /** Last `lines` logical lines of the session's screen, plain text. */
  tail(id: string, lines: number): string[];
  validate(req: LaunchRequest): Promise<ValidationResult>;
  /** Show the launch card (or launch directly when the caller is trusted) and
   *  resolve once the user decides. Undefined when no approval UI is attached. */
  requestLaunch?: (v: ValidatedLaunch, caller: McpCaller) => Promise<LaunchDecision>;
  /** Type text and press Enter (Chat-send semantics). False when it could not be sent. */
  submit(id: string, text: string): Promise<boolean>;
  /** Interrupt the running turn (Escape), never kill. */
  interrupt(id: string): void;
}

export const MCP_MAX_PROMPT = 10_000;
export const MCP_MAX_INPUT = 10_000;
export const READ_DEFAULT_LINES = 40;
export const READ_MAX_LINES = 500;

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
/** Newline and tab are fine in a prompt; every other control/format char is not. */
const CONTROL_EXCEPT_NL_TAB = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
const FORMAT = /\p{Cf}/u;
const REF_RE = /^(?!-)[A-Za-z0-9._/-]+$/;
const AGENT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const goodRef = (s: string) => REF_RE.test(s) && !s.includes('..') && s.length <= 200;
const cleanText = (s: string) => !CONTROL.test(s) && !FORMAT.test(s);

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ToolError(`${key} must be a string`);
  return v;
}

/**
 * The launch request a start_session call describes, with the same shape
 * rules as an argus://new link (launchLink.ts) — except the prompt, which may
 * be longer here (the quoted command cap in validateLaunch still applies).
 * No flags: an orchestrator cannot widen what the new agent may do.
 */
export function parseStartArgs(args: Record<string, unknown>, home: string): LaunchRequest {
  const prompt = optString(args, 'prompt');
  if (!prompt || !prompt.trim()) throw new ToolError('prompt is required');
  if (prompt.length > MCP_MAX_PROMPT) throw new ToolError(`prompt is longer than ${MCP_MAX_PROMPT} characters`);
  if (prompt.trimStart().startsWith('-')) throw new ToolError('prompt must not start with "-"');
  if (CONTROL_EXCEPT_NL_TAB.test(prompt) || FORMAT.test(prompt)) throw new ToolError('prompt contains control characters');

  let folder = optString(args, 'folder');
  if (!folder) throw new ToolError('folder is required');
  if (folder === '~' || folder.startsWith('~/')) folder = home + folder.slice(1);
  if (!folder.startsWith('/') || !cleanText(folder)) throw new ToolError('folder must be an absolute path');

  const agent = optString(args, 'agent') ?? 'claude';
  if (!AGENT_RE.test(agent)) throw new ToolError('agent is not a valid agent id');

  const req: LaunchRequest = { agent, folder, flags: [], prompt };
  const name = optString(args, 'name');
  if (name !== undefined) {
    if (!name.trim() || name.length > 60 || !cleanText(name)) throw new ToolError('name must be 1-60 printable characters');
    req.name = name;
  }
  const worktree = optString(args, 'worktree');
  const base = optString(args, 'base');
  if (base !== undefined && worktree === undefined) throw new ToolError('base needs worktree');
  if (worktree !== undefined) {
    if (!goodRef(worktree)) throw new ToolError('worktree is not a valid branch name');
    if (base !== undefined && !goodRef(base)) throw new ToolError('base is not a valid ref');
    req.worktree = worktree;
    if (base !== undefined) req.base = base;
  }
  return req;
}

function sessionId(args: Record<string, unknown>): string {
  const id = args.id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new ToolError('id must be a session id from list_sessions');
  return id;
}

function summary(s: SessionInfo, caller: McpCaller) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    agent: s.agentType,
    folder: s.folderPath,
    ...(s.worktreeBranch ? { branch: s.worktreeBranch } : {}),
    ...(s.pr ? { pr: { number: s.pr.number, url: s.pr.url, state: s.pr.state, ci: s.pr.ci } } : {}),
    ...(s.id === caller.sessionId ? { self: true } : {}),
    startedByYou: s.spawnedBy === caller.sessionId,
  };
}

/** Write tools reach only the caller's own children: one runaway agent can't type into the rest. */
function ownChild(host: McpHost, args: Record<string, unknown>, caller: McpCaller): SessionInfo {
  const id = sessionId(args);
  const s = host.getSession(id);
  if (!s) throw new ToolError('No such session');
  if (s.spawnedBy !== caller.sessionId) throw new ToolError('Only sessions you started with start_session can be controlled');
  if (s.status === 'exited') throw new ToolError(`Session "${s.name}" has exited`);
  return s;
}

export function createMcpTools(host: McpHost, home: string): ToolDef<McpCaller>[] {
  return [
    {
      name: 'start_session',
      title: 'Start an Argus session',
      description:
        'Start a new agent session in Argus with an initial prompt, optionally in a new git worktree. ' +
        'The user must approve it in Argus first: this call blocks until they start or discard it (up to 10 minutes). ' +
        'Returns the new session id.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The first message the new agent receives.' },
          folder: { type: 'string', description: 'Absolute path (or ~/...) of the repository or folder to work in.' },
          worktree: { type: 'string', description: 'Create a git worktree on this new branch and run there.' },
          base: { type: 'string', description: 'Ref the worktree branch starts from (default HEAD). Needs worktree.' },
          name: { type: 'string', description: 'Session name shown in Argus (max 60 chars).' },
          agent: { type: 'string', description: 'Agent id: claude (default), codex, gemini, or a custom agent id.' },
        },
        required: ['prompt', 'folder'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async run(args, caller) {
        const req = parseStartArgs(args, home);
        if (!host.requestLaunch) throw new ToolError('Argus cannot show an approval card right now (no app window)');
        const v = await host.validate(req);
        if (!v.ok) throw new ToolError(v.error);
        const decision = await host.requestLaunch(v.value, caller);
        if (!decision.ok) throw new ToolError(decision.error);
        const s = host.getSession(decision.sessionId);
        return textResult(
          `Started session "${s?.name ?? decision.sessionId}" (id ${decision.sessionId}). Use read_session to follow it.`,
          { id: decision.sessionId, ...(s ? { name: s.name, status: s.status } : {}) },
        );
      },
    },
    {
      name: 'list_sessions',
      title: 'List Argus sessions',
      description: 'Every session open in Argus with its status (running, waiting, idle, exited), agent, folder, branch and PR.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
      async run(_args, caller) {
        const sessions = host.listSessions().map((s) => summary(s, caller));
        const text = sessions.length === 0
          ? 'No sessions.'
          : sessions.map((s) => `${s.id}  ${s.status.padEnd(7)}  ${s.name}${s.branch ? ` [${s.branch}]` : ''}${s.startedByYou ? '  (started by you)' : ''}${s.self ? '  (this session)' : ''}`).join('\n');
        return textResult(text, { sessions });
      },
    },
    {
      name: 'read_session',
      title: 'Read an Argus session',
      description:
        'Status, branch, PR and the last lines of terminal output of one session. ' +
        'When status is "waiting" the agent is asking something; waitingFor holds the question.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id from list_sessions or start_session.' },
          lines: { type: 'integer', minimum: 1, maximum: READ_MAX_LINES, description: `Lines of output to return (default ${READ_DEFAULT_LINES}).` },
        },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      async run(args, caller) {
        const id = sessionId(args);
        const s = host.getSession(id);
        if (!s) throw new ToolError('No such session');
        const raw = args.lines;
        if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1)) throw new ToolError('lines must be a positive integer');
        const lines = Math.min(READ_MAX_LINES, (raw as number | undefined) ?? READ_DEFAULT_LINES);
        const output = host.tail(id, lines).join('\n');
        const info = {
          ...summary(s, caller),
          ...(s.status === 'waiting' && s.lastPrompt ? { waitingFor: s.lastPrompt } : {}),
          ...(s.promptOptions?.length ? { options: s.promptOptions.map((o) => o.label) } : {}),
        };
        const header = `${s.name} — ${s.status}${s.worktreeBranch ? ` on ${s.worktreeBranch}` : ''}${s.pr ? ` · PR #${s.pr.number}` : ''}`;
        return textResult(`${header}\n\n${output}`, { ...info, output });
      },
    },
    {
      name: 'send_input',
      title: 'Send input to a session',
      description: 'Type text into a session you started and press Enter, like sending a chat message. Answers a waiting prompt too.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id (must be one you started).' },
          text: { type: 'string', description: 'The message to send.' },
        },
        required: ['id', 'text'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async run(args, caller) {
        const text = args.text;
        if (typeof text !== 'string' || !text.trim()) throw new ToolError('text is required');
        if (text.length > MCP_MAX_INPUT) throw new ToolError(`text is longer than ${MCP_MAX_INPUT} characters`);
        if (CONTROL_EXCEPT_NL_TAB.test(text) || FORMAT.test(text)) throw new ToolError('text contains control characters');
        const s = ownChild(host, args, caller);
        if (!(await host.submit(s.id, text))) throw new ToolError(`Could not send to "${s.name}"`);
        return textResult(`Sent to "${s.name}".`);
      },
    },
    {
      name: 'stop_session',
      title: 'Interrupt a session',
      description: 'Interrupt the current turn of a session you started (presses Escape). The session stays open.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Session id (must be one you started).' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(args, caller) {
        const s = ownChild(host, args, caller);
        host.interrupt(s.id);
        return textResult(`Interrupted "${s.name}".`);
      },
    },
  ];
}
