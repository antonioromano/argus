import { relativeTime } from '../app/panels/activityFormat.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Age of a commit for a history list: "just now", "5m ago", "3h ago",
 * "12d ago", then the date ("Mar 4", or "Mar 4, 2024" in another year).
 */
export function commitAge(at: number, now: number): string {
  // A commit dated in the future (clock skew) reads as fresh, not negative.
  if (now - at < 60_000) return 'just now';
  if (now - at < 30 * 86_400_000) return `${relativeTime(at, now)} ago`;
  const date = new Date(at);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** Full local date and time, for tooltips and the commit header. */
export function commitDateTime(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
