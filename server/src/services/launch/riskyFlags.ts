/**
 * Agent CLI flags that change what an agent may do or what it loads, so a
 * deep link carrying them is effectively asking for more than "start an agent
 * in this folder". A web page can open `argus://new?...&flags=...`; the user
 * sees an approval card, and these flags must stand out there rather than sit
 * in a plain argument list.
 *
 * Matched on the flag NAME (the part before `=`), case-insensitively, so
 * `--mcp-config=~/Downloads/x.json` and `--MCP-CONFIG` both match.
 */
const RISKY_EXACT: Record<string, string> = {
  // Claude Code
  '--mcp-config': 'loads MCP servers (arbitrary programs) from a file',
  '--settings': 'loads a settings file (hooks run shell commands)',
  '--add-dir': 'grants access to directories outside the folder',
  '--permission-mode': 'changes the permission mode',
  '--allowedtools': 'pre-approves tools without asking',
  '--allowed-tools': 'pre-approves tools without asking',
  '--plugin-dir': 'loads plugins from a directory',
  '--system-prompt': 'replaces the system prompt',
  '--append-system-prompt': 'injects instructions into the system prompt',
  // Gemini / Codex equivalents
  '--yolo': 'auto-approves every action',
  '-y': 'auto-approves every action',
  '--approval-mode': 'changes the approval mode',
  '--full-auto': 'auto-approves every action',
  '--sandbox': 'changes the sandbox policy',
  '--include-directories': 'grants access to directories outside the folder',
  '--config': 'overrides agent configuration',
};

/** Why `flag` is risky, or null when it isn't. */
export function riskyFlagReason(flag: string): string | null {
  const name = flag.trim().split('=')[0].toLowerCase();
  if (name.startsWith('--dangerously')) return 'disables safety checks';
  return RISKY_EXACT[name] ?? null;
}

/** The risky flags in `flags`, with reasons, in order. */
export function riskyFlags(flags: string[]): Array<{ flag: string; reason: string }> {
  const out: Array<{ flag: string; reason: string }> = [];
  for (const flag of flags) {
    const reason = riskyFlagReason(flag);
    if (reason) out.push({ flag, reason });
  }
  return out;
}
