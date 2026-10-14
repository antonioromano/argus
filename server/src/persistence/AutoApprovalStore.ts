import { readFile, copyFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { AutoApprovalRule } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';
import { validateRuleInput } from '../services/autoApproval/matcher.js';
import { AUTO_APPROVAL_RULES_MAX } from '../constants/autoApproval.js';

interface FileShape {
  version: 1;
  folders: Record<string, AutoApprovalRule[]>;
}

const ID_RE = /^[a-f0-9-]{36}$/;

/** A stored rule is re-validated on load exactly as if the user had just typed it. */
function sanitizeRule(v: unknown): AutoApprovalRule | null {
  const r = v as Partial<AutoApprovalRule> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (typeof r.createdAt !== 'string') return null;
  const checked = validateRuleInput({ tool: r.tool, bashPrefix: r.bashPrefix, pathGlob: r.pathGlob });
  if (!checked.ok) return null;
  const rule: AutoApprovalRule = { id: r.id, tool: checked.tool, createdAt: r.createdAt };
  if (checked.bashPrefix !== undefined) rule.bashPrefix = checked.bashPrefix;
  if (checked.pathGlob !== undefined) rule.pathGlob = checked.pathGlob;
  return rule;
}

/**
 * F5 auto-approval rules, keyed by the realpath of a session folder. Lives in
 * the server data dir (server/data/auto-approval.json, or the packaged app's
 * userData), never inside a session folder: an agent can write its own folder,
 * so a rule file there would let it approve itself. Not an AppConfig key either
 * — config is a single blob the client PUTs whole.
 *
 * Held in memory after `load()` so the PreToolUse decision path is synchronous;
 * writes are serialized and atomic.
 */
export class AutoApprovalStore {
  private folders = new Map<string, AutoApprovalRule[]>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    this.folders.clear();
    let data: unknown;
    try {
      data = JSON.parse(await readFile(this.filePath, 'utf-8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      console.warn('[AutoApprovalStore] load failed:', err);
      if (err instanceof SyntaxError) {
        await copyFile(this.filePath, `${this.filePath}.bak`).catch((e) => console.warn('[AutoApprovalStore] backup failed:', e));
      }
      return;
    }
    const folders = (data as Partial<FileShape> | null)?.folders;
    if (!folders || typeof folders !== 'object') return;
    for (const [folder, rules] of Object.entries(folders)) {
      if (!path.isAbsolute(folder) || !Array.isArray(rules)) continue;
      const clean = rules.map(sanitizeRule).filter((r): r is AutoApprovalRule => r !== null).slice(0, AUTO_APPROVAL_RULES_MAX);
      if (clean.length > 0) this.folders.set(folder, clean);
    }
  }

  rulesFor(folder: string): AutoApprovalRule[] {
    return [...(this.folders.get(folder) ?? [])];
  }

  /** Folders with at least one rule. */
  folderList(): string[] {
    return [...this.folders.keys()];
  }

  /** Add an already-validated rule. Throws when the folder is full. */
  async addRule(
    folder: string,
    input: Pick<AutoApprovalRule, 'tool' | 'bashPrefix' | 'pathGlob'>,
    now: Date = new Date(),
  ): Promise<AutoApprovalRule> {
    const rules = this.folders.get(folder) ?? [];
    if (rules.length >= AUTO_APPROVAL_RULES_MAX) throw new Error(`A folder holds at most ${AUTO_APPROVAL_RULES_MAX} rules`);
    const rule: AutoApprovalRule = { id: randomUUID(), tool: input.tool, createdAt: now.toISOString() };
    if (input.bashPrefix !== undefined) rule.bashPrefix = input.bashPrefix;
    if (input.pathGlob !== undefined) rule.pathGlob = input.pathGlob;
    this.folders.set(folder, [...rules, rule]);
    await this.persist();
    return rule;
  }

  /** True when the rule existed. */
  async removeRule(folder: string, id: string): Promise<boolean> {
    const rules = this.folders.get(folder);
    if (!rules || !rules.some((r) => r.id === id)) return false;
    const next = rules.filter((r) => r.id !== id);
    if (next.length > 0) this.folders.set(folder, next);
    else this.folders.delete(folder);
    await this.persist();
    return true;
  }

  private persist(): Promise<void> {
    const snapshot: FileShape = { version: 1, folders: Object.fromEntries(this.folders) };
    const body = JSON.stringify(snapshot, null, 2);
    this.writeChain = this.writeChain.catch(() => {}).then(() => atomicWrite(this.filePath, body));
    return this.writeChain;
  }
}
