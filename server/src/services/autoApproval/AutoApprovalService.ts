import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AutoApprovalAuditEntry } from '@argus/shared';
import type { AutoApprovalStore } from '../../persistence/AutoApprovalStore.js';
import { AUTO_APPROVAL_AUDIT_MAX } from '../../constants/autoApproval.js';
import { allowHookOutput, matchRules } from './matcher.js';

/** What the service needs to know about a session. Read from the server's own
 *  session table — never from the hook payload or the agent's environment. */
export interface AutoApprovalSessionView {
  folderPath: string;
  agentType: string;
  status: string;
}

export interface AutoApprovalServiceDeps {
  store: Pick<AutoApprovalStore, 'rulesFor'>;
  /** Live global switch (AppConfig.autoApprovalEnabled). */
  isEnabled: () => boolean;
  getSession: (id: string) => AutoApprovalSessionView | undefined;
  now?: () => Date;
}

/** Permission modes in which an "allow" means exactly "skip this prompt". In
 *  plan mode an allow could push an edit through, and the others need no help. */
const ACTIVE_MODES = new Set(['default', 'acceptEdits']);

/** True when rules can act in this permission mode. */
export function isActiveMode(mode: string): boolean {
  return ACTIVE_MODES.has(mode);
}

/** `permissions.defaultMode` from a parsed Claude settings file, or null. */
export function defaultModeFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null;
  const perms = (settings as { permissions?: unknown }).permissions;
  if (!perms || typeof perms !== 'object') return null;
  const mode = (perms as { defaultMode?: unknown }).defaultMode;
  return typeof mode === 'string' && mode ? mode : null;
}

/**
 * The user's Claude default permission mode (~/.claude/settings.json), or null
 * when unset or unreadable. Used only to tell the user that rules are inactive
 * (e.g. `auto` mode); decisions always use the mode in the hook payload.
 */
export function readClaudeDefaultMode(home: string = os.homedir()): string | null {
  try {
    return defaultModeFromSettings(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8')));
  } catch {
    return null;
  }
}

export function realFolder(folderPath: string): string | null {
  try {
    return fs.realpathSync.native(folderPath);
  } catch {
    return null;
  }
}

/**
 * F5 decision point. Given a session id (already authenticated by its HMAC
 * token) and the raw PreToolUse hook JSON, return the hook stdout object for an
 * allow, or null for "say nothing". Null is the answer to every doubt.
 */
export class AutoApprovalService {
  private audit = new Map<string, AutoApprovalAuditEntry[]>();
  private now: () => Date;

  constructor(private deps: AutoApprovalServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  decide(sessionId: string, hook: unknown): ReturnType<typeof allowHookOutput> | null {
    if (!this.deps.isEnabled()) return null;
    const session = this.deps.getSession(sessionId);
    if (!session || session.status === 'exited' || session.agentType !== 'claude') return null;
    if (!hook || typeof hook !== 'object' || Array.isArray(hook)) return null;
    const h = hook as Record<string, unknown>;
    if (h.hook_event_name !== 'PreToolUse') return null;
    if (typeof h.permission_mode !== 'string' || !ACTIVE_MODES.has(h.permission_mode)) return null;

    // The folder comes from the session table; the hook's `cwd` is ignored.
    const folder = realFolder(session.folderPath);
    if (!folder) return null;
    const rules = this.deps.store.rulesFor(folder);
    if (rules.length === 0) return null;

    const match = matchRules(rules, folder, h.tool_name, h.tool_input);
    if (!match) return null;
    this.record({ at: this.now().toISOString(), sessionId, tool: match.tool, ruleId: match.rule.id, summary: match.summary });
    return allowHookOutput(match.rule.id);
  }

  private record(entry: AutoApprovalAuditEntry): void {
    const ring = this.audit.get(entry.sessionId) ?? [];
    ring.push(entry);
    if (ring.length > AUTO_APPROVAL_AUDIT_MAX) ring.splice(0, ring.length - AUTO_APPROVAL_AUDIT_MAX);
    this.audit.set(entry.sessionId, ring);
  }

  auditFor(sessionId: string): AutoApprovalAuditEntry[] {
    return [...(this.audit.get(sessionId) ?? [])];
  }

  /** Newest first, merged across the given sessions. */
  auditForSessions(sessionIds: readonly string[]): AutoApprovalAuditEntry[] {
    return sessionIds
      .flatMap((id) => this.audit.get(id) ?? [])
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  forgetSession(sessionId: string): void {
    this.audit.delete(sessionId);
  }
}
