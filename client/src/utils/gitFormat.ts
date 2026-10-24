const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Age of a commit for a history list: "just now", "5m ago", "3h ago",
 * "12d ago", then the date ("Mar 4", or "Mar 4, 2024" in another year).
 */
export function commitAge(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  // A commit dated in the future (clock skew) reads as fresh, not negative.
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
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
