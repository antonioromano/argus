import { SHELL_AGENT_ID, type AgentDefinition, type SessionInfo } from '@argus/shared';

/** Exit status a POSIX shell reports when it can't find the command. */
const COMMAND_NOT_FOUND = 127;
/** An agent that ran this long and then exited 127 most likely reported 127
 *  itself (e.g. a hook exec'd a missing tool) — it was found. */
export const NOT_FOUND_WINDOW_MS = 5000;

/** ExitedCard's exit-related props for a session. The plain Shell agent is
 *  left out: its exit code is the last command the user ran, not a lookup. */
export function exitedCardExitProps(session: SessionInfo, agent: AgentDefinition | undefined) {
  if (session.agentType === SHELL_AGENT_ID) return {};
  return {
    exitCode: session.exitCode,
    exitedAfterMs: session.exitedAfterMs,
    agentCommand: agent?.command ?? session.agentType,
    installCommand: agent?.installCommand,
  };
}

export function isCommandNotFoundExit(exitCode: number | undefined, exitedAfterMs: number | undefined): boolean {
  return exitCode === COMMAND_NOT_FOUND && exitedAfterMs !== undefined && exitedAfterMs <= NOT_FOUND_WINDOW_MS;
}
