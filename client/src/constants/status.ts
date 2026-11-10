import type { DisplayStatus } from '../utils/displayStatus.js';

/** Canonical status colors — Argus OS design tokens (auto-switch dark/light). */
export const STATUS_COLORS: Record<DisplayStatus, string> = {
  waiting: 'var(--status-waiting)',
  running: 'var(--status-running)',
  agents:  'var(--status-running)',
  idle:    'var(--status-idle)',
  done:    'var(--status-done)',
  exited:  'var(--status-exited)',
};

/** Uppercase mono labels — design language. */
export const STATUS_LABELS: Record<DisplayStatus, string> = {
  waiting: 'WAITING',
  running: 'RUNNING',
  agents:  'AGENTS',
  idle:    'IDLE',
  done:    'DONE',
  exited:  'EXITED',
};

export const STATUS_PULSE: Record<DisplayStatus, boolean> = {
  waiting: true,
  running: false,
  agents:  false,
  idle:    false,
  done:    false,
  exited:  false,
};

export const STATUS_MARQUEE: Record<DisplayStatus, boolean> = {
  waiting: false,
  running: true,
  agents:  true,
  idle:    false,
  done:    false,
  exited:  false,
};

