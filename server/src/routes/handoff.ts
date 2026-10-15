import { Router } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import type { AgentDefinition, AppConfig, HandoffPreviewResponse, HandoffResponse, SessionInfo } from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import { promptArgs } from '../services/AgentRegistry.js';
import { SHELL_AGENT_ID } from '../constants/agents.js';
import { resolveSessionFolder } from '../utils/sessionFolder.js';
import { workRootOf } from '../utils/workRoot.js';
import { validateFlags } from '../utils/flags.js';
import {
  HANDOFF_DEFAULT_MESSAGES,
  HANDOFF_MAX_MESSAGES,
  HANDOFF_NOTE_MAX,
  buildHandoffBrief,
  collectGitContext,
  handoffPrompt,
  readLastMessages,
  writeHandoffBrief,
  type GitContext,
} from '../services/handoff.js';
import type { TranscriptMessage } from '../services/search/transcriptSearch.js';

/** Beta F12 wiring. `isEnabled` false → the route 404s. */
export interface HandoffDeps {
  isEnabled: () => boolean;
  /** `<dataDir>/handoffs` */
  handoffDir: string;
  loadConfig: () => Promise<AppConfig>;
  agentRegistry: { getById(id: string, customAgents: AgentDefinition[]): AgentDefinition | undefined };
  manager: {
    getSessionInfo(id: string): SessionInfo | undefined;
    resolveWithinAnySession(p: string): string | null;
    handoffTranscripts(id: string): string[];
  };
  /** Create the new shell. `initialPrompt` is set when the agent takes one on its command line. */
  createSession: (folder: string, name: string, agentType: string, flags: string[], initialPrompt?: string) => Promise<SessionInfo>;
  /** Fallback for agents without a prompt argument: type `text` + Enter once the shell is ready. */
  typePrompt: (sessionId: string, text: string) => void;
  /** Test seams. */
  gitContext?: (folder: string, includeDiff: boolean) => Promise<GitContext>;
  readMessages?: (paths: readonly string[], count: number) => Promise<TranscriptMessage[]>;
  newId?: () => string;
  now?: () => Date;
}

type Parsed = { ok: true; agentType?: string; folderPath?: string; messageCount: number; includeDiff: boolean; note: string; preview: boolean } | { ok: false; error: string };

function parseBody(raw: unknown): Parsed {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (b.agentType !== undefined && (typeof b.agentType !== 'string' || !b.agentType)) return { ok: false, error: 'agentType must be a string' };
  if (b.folderPath !== undefined && (typeof b.folderPath !== 'string' || !path.isAbsolute(b.folderPath))) return { ok: false, error: 'folderPath must be an absolute path' };
  let messageCount = HANDOFF_DEFAULT_MESSAGES;
  if (b.messageCount !== undefined) {
    if (typeof b.messageCount !== 'number' || !Number.isInteger(b.messageCount) || b.messageCount < 0 || b.messageCount > HANDOFF_MAX_MESSAGES) {
      return { ok: false, error: `messageCount must be an integer from 0 to ${HANDOFF_MAX_MESSAGES}` };
    }
    messageCount = b.messageCount;
  }
  if (b.includeDiff !== undefined && typeof b.includeDiff !== 'boolean') return { ok: false, error: 'includeDiff must be a boolean' };
  if (b.note !== undefined && typeof b.note !== 'string') return { ok: false, error: 'note must be a string' };
  const note = (b.note as string | undefined) ?? '';
  if (note.length > HANDOFF_NOTE_MAX) return { ok: false, error: `note is longer than ${HANDOFF_NOTE_MAX} characters` };
  if (b.preview !== undefined && typeof b.preview !== 'boolean') return { ok: false, error: 'preview must be a boolean' };
  return {
    ok: true,
    agentType: b.agentType as string | undefined,
    folderPath: b.folderPath as string | undefined,
    messageCount,
    includeDiff: b.includeDiff !== false,
    note,
    preview: b.preview === true,
  };
}

/** `POST /api/sessions/:id/handoff` — mounted on /api/sessions, behind the auth middleware. */
export function createHandoffRoutes(deps: HandoffDeps): Router {
  const router = Router();
  const gitContext = deps.gitContext ?? collectGitContext;
  const readMessages = deps.readMessages ?? readLastMessages;

  router.post('/:id/handoff', asyncHandler(async (req, res) => {
    if (!deps.isEnabled()) {
      res.status(404).json({ error: 'Agent handoff is a beta feature that is switched off.' });
      return;
    }
    const source = deps.manager.getSessionInfo(String(req.params.id));
    if (!source) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const body = parseBody(req.body);
    if (!body.ok) {
      res.status(400).json({ error: body.error });
      return;
    }

    // The source folder is only ever read through a managed session's scope.
    const sourceFolder = deps.manager.resolveWithinAnySession(workRootOf(source));
    if (!sourceFolder) {
      res.status(400).json({ error: 'The source folder is outside every managed session' });
      return;
    }

    const config = await deps.loadConfig();
    const agentType = body.agentType ?? source.agentType;
    const agent = deps.agentRegistry.getById(agentType, config.customAgents ?? []);
    if (!agent) {
      res.status(400).json({ error: `Unknown agent type: "${agentType}"` });
      return;
    }
    if (agent.id === SHELL_AGENT_ID) {
      res.status(400).json({ error: 'A plain shell cannot take over a handoff; pick an agent' });
      return;
    }

    // Same rule as session creation: absolute, existing, realpath'd directory.
    let targetFolder: string;
    try {
      targetFolder = await resolveSessionFolder(body.folderPath ?? sourceFolder);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid folder' });
      return;
    }

    const isClaude = source.agentType === 'claude';
    const [git, messages] = await Promise.all([
      gitContext(sourceFolder, body.includeDiff),
      isClaude ? readMessages(deps.manager.handoffTranscripts(source.id), body.messageCount) : Promise.resolve(null),
    ]);
    const brief = buildHandoffBrief({
      sourceName: source.name,
      sourceAgent: source.agentType,
      folder: sourceFolder,
      git,
      messages,
      note: body.note,
      generatedAt: deps.now?.() ?? new Date(),
    });
    const stats = {
      bytes: Buffer.byteLength(brief, 'utf8'),
      messages: messages?.length ?? 0,
      isGitRepo: git.isGitRepo,
      diffTruncated: git.diffTruncated,
    };
    if (body.preview) {
      const out: HandoffPreviewResponse = { preview: true, ...stats };
      res.json(out);
      return;
    }

    const briefPath = await writeHandoffBrief(deps.handoffDir, (deps.newId ?? randomUUID)(), brief);
    const prompt = handoffPrompt(briefPath, body.note);
    const viaArgs = promptArgs(agent, prompt) !== null;
    // The new agent's sticky flag defaults, the same ones the create sheet preselects.
    const flags = (config.agentFlags?.[agent.id] ?? []).filter((f) => f.enabled).map((f) => f.value);
    const flagError = flags.length ? validateFlags(flags) : null;
    let session: SessionInfo;
    try {
      session = await deps.createSession(targetFolder, `${source.name} (handoff)`, agent.id, flagError ? [] : flags, viaArgs ? prompt : undefined);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create session' });
      return;
    }
    if (!viaArgs) deps.typePrompt(session.id, prompt);
    const out: HandoffResponse = { preview: false, ...stats, session, briefPath };
    res.status(201).json(out);
  }));

  return router;
}
