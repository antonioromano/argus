import type { BackendHealth } from '@argus/shared';

export type ConnectionTone = 'ok' | 'warn' | 'danger';

/**
 * One line for the app's connection: the socket to the Argus server first
 * (nothing else can be trusted while it is down), then the pty backend.
 * `null` health = not known yet, read as fine rather than flashing a warning.
 */
export function connectionState(
  socketConnected: boolean,
  health: BackendHealth | null,
): { label: string; tone: ConnectionTone; hint: string } {
  if (!socketConnected) {
    return { label: 'Reconnecting…', tone: 'warn', hint: 'The connection to the Argus server dropped. Sessions keep running.' };
  }
  switch (health?.state) {
    case 'down':
      return { label: 'Daemon down', tone: 'danger', hint: 'argusd stopped answering. Sessions keep running; Argus keeps retrying.' };
    case 'reconnecting':
      return { label: 'Reconnecting to daemon…', tone: 'warn', hint: 'The connection to argusd dropped. Sessions keep running.' };
    case 'drain':
      return { label: 'Daemon outdated', tone: 'warn', hint: 'argusd is from another Argus version. It retires once its sessions end.' };
    default:
      return {
        label: 'Connected',
        tone: 'ok',
        hint: health?.kind === 'tmux' ? 'Sessions run in tmux' : 'Sessions run in argusd',
      };
  }
}
