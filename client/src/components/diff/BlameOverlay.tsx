import { useState } from 'react';
import type { BlameLineEntry } from '@argus/shared';

interface BlameOverlayProps {
  entry: BlameLineEntry;
}

/** Returns up to 2 uppercase initials from a name (first char of each word). */
function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Returns a human-friendly relative date: "today", "3d", "2w", "1mo", "2y". */
function getRelativeDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Renders a compact inline blame annotation for a single diff gutter row.
 * Clicking copies the full commit hash to the clipboard with brief visual feedback.
 */
export function BlameOverlay({ entry }: BlameOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    navigator.clipboard.writeText(entry.hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    });
  };

  // Tooltip shows author, date, and first line of summary (capped for readability)
  const tooltipContent = `${entry.author} · ${entry.date.slice(0, 10)}\n${entry.summary}`.slice(0, 120);

  return (
    <div
      title={tooltipContent}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono, monospace)',
        color: copied
          ? 'var(--color-success, #2ecc71)'
          : 'var(--color-text-muted, rgba(255,255,255,0.35))',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        paddingRight: '4px',
        transition: 'color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? (
        <span>Copied!</span>
      ) : (
        <>
          {/* Author initials */}
          <span style={{ fontWeight: 600 }}>{getInitials(entry.author)}</span>
          {/* Relative age */}
          <span>{getRelativeDate(entry.date)}</span>
          {/* Abbreviated hash */}
          <span style={{ opacity: 0.7 }}>{entry.hash.slice(0, 7)}</span>
        </>
      )}
    </div>
  );
}
