import type { LaunchRequest, RunMode, TerminalEngine } from '@argus/shared';

export type LinkErrorClass =
  | 'wrong-scheme' | 'unknown-host' | 'too-long' | 'unknown-param' | 'duplicate-param'
  | 'missing-agent' | 'missing-folder' | 'bad-folder' | 'bad-engine' | 'bad-mode'
  | 'bad-flag-shape' | 'bad-prompt' | 'bad-name' | 'bad-worktree' | 'base-without-worktree'
  | 'bad-launcher-id' | 'bad-notif-id';

export type ParsedLink =
  | { ok: true; kind: 'new'; request: LaunchRequest }
  | { ok: true; kind: 'run'; launcherId: string }
  | { ok: true; kind: 'notif'; sessionId: string }
  | { ok: false; error: LinkErrorClass };

export const MAX_URL = 8192;
export const MAX_PROMPT = 4096;
export const LAUNCHER_ID_RE = /^[a-z0-9-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SINGLETONS = ['agent', 'folder', 'prompt', 'engine', 'mode', 'name', 'worktree', 'base'] as const;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_EXCEPT_NL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
const FORMAT = /\p{Cf}/u;
const REF_RE = /^(?!-)[A-Za-z0-9._/-]+$/;

const fail = (error: LinkErrorClass): ParsedLink => ({ ok: false, error });
const cleanText = (s: string) => !CONTROL.test(s) && !FORMAT.test(s);
const goodRef = (s: string) => REF_RE.test(s) && !s.includes('..');

export function parseLaunchUrl(raw: string, scheme: string, home: string): ParsedLink {
  let url: URL;
  try { url = new URL(raw); } catch { return fail('wrong-scheme'); }
  if (url.protocol !== `${scheme}:`) return fail('wrong-scheme');
  if (raw.length > MAX_URL) return fail('too-long');
  const path = url.pathname.replace(/\/$/, '');

  if (url.host === 'notif') {
    const id = path.replace(/^\//, '');
    return UUID_RE.test(id) ? { ok: true, kind: 'notif', sessionId: id } : fail('bad-notif-id');
  }
  if (url.host === 'run') {
    if (url.search) return fail('unknown-param');
    const id = path.replace(/^\//, '');
    return LAUNCHER_ID_RE.test(id) ? { ok: true, kind: 'run', launcherId: id } : fail('bad-launcher-id');
  }
  if (url.host !== 'new') return fail('unknown-host');

  const params = url.searchParams;
  for (const key of new Set(params.keys())) {
    if (key !== 'flag' && !(SINGLETONS as readonly string[]).includes(key)) return fail('unknown-param');
    if (key !== 'flag' && params.getAll(key).length > 1) return fail('duplicate-param');
  }
  const agent = params.get('agent');
  if (!agent) return fail('missing-agent');
  let folder = params.get('folder');
  if (!folder) return fail('missing-folder');
  if (folder === '~' || folder.startsWith('~/')) folder = home + folder.slice(1);
  if (!folder.startsWith('/') || !cleanText(folder)) return fail('bad-folder');

  const flags = params.getAll('flag');
  if (flags.some((f) => !/^-/.test(f) || /\s/.test(f) || !cleanText(f))) return fail('bad-flag-shape');

  const request: LaunchRequest = { agent, folder, flags };
  const prompt = params.get('prompt');
  if (prompt !== null) {
    if (prompt.length > MAX_PROMPT || prompt.trimStart().startsWith('-') || CONTROL_EXCEPT_NL.test(prompt) || FORMAT.test(prompt)) {
      return fail('bad-prompt');
    }
    request.prompt = prompt;
  }
  const engine = params.get('engine');
  if (engine !== null) {
    if (engine !== 'web' && engine !== 'native') return fail('bad-engine');
    request.engine = engine as TerminalEngine;
  }
  const mode = params.get('mode');
  if (mode !== null) {
    if (mode !== 'persistent' && mode !== 'direct') return fail('bad-mode');
    request.mode = mode as RunMode;
  }
  const name = params.get('name');
  if (name !== null) {
    if (!name.trim() || name.length > 60 || !cleanText(name)) return fail('bad-name');
    request.name = name;
  }
  const worktree = params.get('worktree');
  const base = params.get('base');
  if (base !== null && worktree === null) return fail('base-without-worktree');
  if (worktree !== null) {
    if (!goodRef(worktree) || (base !== null && !goodRef(base))) return fail('bad-worktree');
    request.worktree = worktree;
    if (base !== null) request.base = base;
  }
  return { ok: true, kind: 'new', request };
}
