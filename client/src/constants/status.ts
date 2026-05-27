import type { SessionStatus } from '@argus/shared';

/** Canonical status colors — Argus OS design tokens (auto-switch dark/light). */
export const STATUS_COLORS: Record<SessionStatus, string> = {
  waiting: 'var(--status-waiting)',
  running: 'var(--status-running)',
  idle:    'var(--status-idle)',
  exited:  'var(--status-exited)',
};

export const STATUS_BG_COLORS: Record<SessionStatus, string> = {
  waiting: 'var(--status-waiting-bg)',
  running: 'var(--status-running-bg)',
  idle:    'var(--status-idle-bg)',
  exited:  'var(--status-exited-bg)',
};

/** Uppercase mono labels — design language. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  waiting: 'WAITING',
  running: 'RUNNING',
  idle:    'IDLE',
  exited:  'EXITED',
};

export const STATUS_PULSE: Record<SessionStatus, boolean> = {
  waiting: true,
  running: false,
  idle:    false,
  exited:  false,
};

export const STATUS_MARQUEE: Record<SessionStatus, boolean> = {
  waiting: false,
  running: true,
  idle:    false,
  exited:  false,
};

/** @deprecated kept for back-compat with archived components. */
export const STATUS_GLOW_SHADOWS: Record<SessionStatus, string> = {
  waiting: '0 0 16px var(--accent-glow)',
  running: 'none',
  idle:    'none',
  exited:  'none',
};

export const STATUS_STATE_GLOWS: Record<SessionStatus, string> = {
  waiting: 'radial-gradient(ellipse at 50% 0%, var(--status-waiting-bg) 0%, transparent 70%)',
  running: 'radial-gradient(ellipse at 50% 0%, var(--status-running-bg) 0%, transparent 70%)',
  idle:    'radial-gradient(ellipse at 50% 0%, var(--status-idle-bg) 0%, transparent 70%)',
  exited:  'none',
};
