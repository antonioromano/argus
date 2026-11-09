import type { ChatMessage, SessionStatus } from '@argus/shared';

/**
 * Claude Code writes a reply to its transcript only once it is complete, so
 * the Chat has dead air while Claude writes. Show "Claude is writing…" there,
 * and only when nothing else explains the wait: the session runs, no helper
 * agent runs, and the last row is a prompt or a tool group with every step
 * settled. Never while a permission question waits or a tool step is pending.
 */
export function showTypingRow(status: SessionStatus, agentsRunning: number, lastRow: ChatMessage | undefined): boolean {
  if (status !== 'running' || agentsRunning !== 0 || !lastRow) return false;
  if (lastRow.role === 'user') return true;
  const toolGroup = lastRow.blocks.length > 0 && lastRow.blocks.every((b) => b.kind === 'tool');
  return toolGroup && !lastRow.blocks.some((b) => b.kind === 'tool' && b.status === 'pending');
}
