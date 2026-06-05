import type { SessionStatus } from '@argus/shared';

/** Canonical status colors — Argus OS design tokens (auto-switch dark/light). */
export const STATUS_COLORS: Record<SessionStatus, string> = {
  waiting: 'var(--status-waiting)',
  running: 'var(--status-running)',
  idle:    'var(--status-idle)',
  done:    'var(--status-done)',
  exited:  'var(--status-exited)',
};

/** Uppercase mono labels — design language. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  waiting: 'WAITING',
  running: 'RUNNING',
  idle:    'IDLE',
  done:    'DONE',
  exited:  'EXITED',
};

export const STATUS_PULSE: Record<SessionStatus, boolean> = {
  waiting: true,
  running: false,
  idle:    false,
  done:    false,
  exited:  false,
};

export const STATUS_MARQUEE: Record<SessionStatus, boolean> = {
  waiting: false,
  running: true,
  idle:    false,
  done:    false,
  exited:  false,
};

