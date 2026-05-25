import { ArrowUpCircle } from 'lucide-react';

interface MacUpdateBannerProps {
  /** The new version string, e.g. "1.4.2". */
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
}

/**
 * Compact inline banner shown below the toolbar when a new Argus version
 * is available. Replaces the full UpdateModal for the Electron layout.
 */
export function MacUpdateBanner({ version, onUpdate, onDismiss }: MacUpdateBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        height: 36,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 8,
        flexShrink: 0,
        background: 'rgba(240, 165, 0, 0.10)',
        borderBottom: '1px solid rgba(240, 165, 0, 0.25)',
      }}
    >
      {/* Update icon */}
      <ArrowUpCircle
        size={14}
        strokeWidth={2}
        style={{ color: 'var(--color-warning, #f0a500)', flexShrink: 0 }}
      />

      {/* Version label */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-warning, #f0a500)',
          whiteSpace: 'nowrap',
        }}
      >
        Argus v{version} available
      </span>

      {/* Push buttons to the right */}
      <span style={{ flex: 1 }} />

      {/* "Update now" CTA */}
      <button
        onClick={onUpdate}
        style={{
          border: 'none',
          background: 'none',
          color: 'var(--color-warning, #f0a500)',
          fontWeight: 600,
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: 0,
          lineHeight: 1,
        }}
      >
        Update now
      </button>

      {/* Dismiss */}
      <button
        aria-label="Dismiss update banner"
        onClick={onDismiss}
        style={{
          marginLeft: 8,
          border: 'none',
          background: 'none',
          color: 'var(--color-text-muted)',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        &#xD7;
      </button>
    </div>
  );
}
