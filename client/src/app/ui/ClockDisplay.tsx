import { useEffect, useState } from 'react';

function formatTime(date: Date, showSeconds: boolean): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  if (!showSeconds) return `${h}:${m}`;
  return `${h}:${m}:${String(date.getSeconds()).padStart(2, '0')}`;
}

/** HH:MM(:SS), ticking once a second. Styled by its container. */
export function ClockDisplay({ showSeconds = false, className }: { showSeconds?: boolean; className?: string }) {
  // Store the raw Date in state and format during render: a `showSeconds` change
  // reformats immediately via the prop without a synchronous setState in the effect.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className={className}>{formatTime(now, showSeconds)}</span>;
}
