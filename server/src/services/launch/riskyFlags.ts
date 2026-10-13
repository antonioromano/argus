/**
 * Which deep-link flags need the user's attention on the approval card.
 *
 * A web page can open `argus://new?...&flags=...`. A denylist of "dangerous"
 * flags can't keep up with the agent CLIs' parsers — yargs (Gemini) accepts
 * camelCase (`--approvalMode`) and `--no-x` negation, Claude has
 * `--allow-dangerously-skip-permissions`, short flags cluster (`-yf`). So this
 * is an ALLOWLIST: a few flags per agent known to be benign pass quietly;
 * EVERY other flag is surfaced — with a specific reason when we know one, else
 * as "unrecognized flag — review".
 *
 * Names are compared normalized: lowercased, leading dashes stripped, every
 * `-`/`_` inside removed, a leading `no` dropped. Short-flag clusters
 * (`-yf`) are checked letter by letter.
 */

/** Known-benign flags per agent (normalized long names and short letters). */
const BENIGN: Record<string, { long: string[]; short: string[] }> = {
  // claude: -c/--continue resumes the last conversation; -r/--resume a chosen one.
  claude: { long: ['model', 'verbose', 'debug', 'continue', 'resume'], short: ['c', 'r'] },
  // gemini: -m/--model, -d/--debug. (-y is --yolo, -s is --sandbox: not benign.)
  gemini: { long: ['model', 'debug'], short: ['m', 'd'] },
  // codex: -m/--model. (-c is a config override, -s sandbox, -a approval policy.)
  codex: { long: ['model'], short: ['m'] },
};

/** Specific reasons for flags known to widen what an agent may do (normalized). */
const LONG_REASONS: Record<string, string> = {
  mcpconfig: 'loads MCP servers (arbitrary programs) from a file',
  strictmcpconfig: 'changes which MCP servers load',
  settings: 'loads a settings file (hooks run shell commands)',
  adddir: 'grants access to directories outside the folder',
  includedirectories: 'grants access to directories outside the folder',
  permissionmode: 'changes the permission mode',
  allowedtools: 'pre-approves tools without asking',
  disallowedtools: 'changes which tools are allowed',
  plugindir: 'loads plugins from a directory',
  systemprompt: 'replaces the system prompt',
  appendsystemprompt: 'injects instructions into the system prompt',
  yolo: 'auto-approves every action',
  approvalmode: 'changes the approval mode',
  askforapproval: 'changes the approval policy',
  fullauto: 'auto-approves every action',
  sandbox: 'changes the sandbox policy',
  config: 'overrides agent configuration',
  profile: 'switches agent configuration profile',
};

const SHORT_REASONS: Record<string, Record<string, string>> = {
  gemini: { y: 'auto-approves every action (--yolo)', s: 'changes the sandbox policy (--sandbox)' },
  codex: { c: 'overrides agent configuration (-c key=value)', s: 'changes the sandbox policy (--sandbox)', a: 'changes the approval policy (--ask-for-approval)' },
};

export const UNRECOGNIZED = 'unrecognized flag — review';

/** Normalized long-flag name: `--No-Approval_Mode=x` → `approvalmode`. */
export function normalizeFlagName(flag: string): string {
  let n = flag.trim().split('=')[0].toLowerCase().replace(/^-+/, '').replace(/[-_]/g, '');
  if (n.startsWith('no') && n.length > 2) n = n.slice(2);
  return n;
}

/** Why `flag` needs review for `agentId`, or null when it is known-benign. */
export function flagReviewReason(agentId: string, flag: string): string | null {
  const raw = flag.trim();
  const benign = BENIGN[agentId] ?? { long: [], short: [] };
  if (raw.startsWith('--')) {
    const name = normalizeFlagName(raw);
    if (name.includes('dangerous')) return 'disables safety checks';
    if (LONG_REASONS[name]) return LONG_REASONS[name];
    return benign.long.includes(name) ? null : UNRECOGNIZED;
  }
  // Short flag or cluster: every letter must be benign.
  const letters = raw.replace(/^-/, '').split('=')[0];
  if (!letters) return UNRECOGNIZED;
  const reasons: string[] = [];
  for (const ch of letters) {
    const specific = SHORT_REASONS[agentId]?.[ch.toLowerCase()];
    if (specific) reasons.push(`-${ch}: ${specific}`);
    else if (!benign.short.includes(ch)) reasons.push(`-${ch}: ${UNRECOGNIZED}`);
  }
  return reasons.length ? reasons.join(', ') : null;
}

/** The flags in `flags` that need review, with reasons, in order. */
export function flagsNeedingReview(agentId: string, flags: string[]): Array<{ flag: string; reason: string }> {
  const out: Array<{ flag: string; reason: string }> = [];
  for (const flag of flags) {
    const reason = flagReviewReason(agentId, flag);
    if (reason) out.push({ flag, reason });
  }
  return out;
}
