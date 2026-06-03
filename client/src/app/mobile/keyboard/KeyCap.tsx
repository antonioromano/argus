import type { ReactNode } from 'react';

export type KeyTone = 'default' | 'accent' | 'danger';

interface KeyCapProps {
  label: ReactNode;
  /** Optional small caption under the label (e.g. "stop", "submit"). */
  sub?: string;
  tone?: KeyTone;
  onPress: () => void;
  ariaLabel?: string;
  /** flex-grow weight when laid out in a row (toolbar/qwerty). */
  grow?: number;
  /** Stretch to fill its grid cell height (used by the pad grid). */
  fill?: boolean;
  disabled?: boolean;
}

function toneStyle(tone: KeyTone): React.CSSProperties {
  switch (tone) {
    case 'accent':
      return { background: 'var(--accent)', color: 'var(--fg-on-accent)', border: '1px solid var(--accent)' };
    case 'danger':
      return { background: 'var(--bg-2)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 33%, transparent)' };
    default:
      return { background: 'var(--bg-2)', color: 'var(--fg-0)', border: '1px solid var(--line-2)' };
  }
}

/** A single tappable key. Min 44px touch target; pressed scale feedback via CSS class. */
export function KeyCap({ label, sub, tone = 'default', onPress, ariaLabel, grow, fill, disabled }: KeyCapProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onPress}
      disabled={disabled}
      className="mobile-keycap"
      style={{
        flex: grow != null ? `${grow} 1 0` : undefined,
        minWidth: 40,
        minHeight: 44,
        height: fill ? '100%' : undefined,
        padding: '0 var(--s-2)',
        borderRadius: 'var(--r-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-base)',
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        opacity: disabled ? 0.4 : 1,
        ...toneStyle(tone),
      }}
    >
      <span>{label}</span>
      {sub && (
        <span style={{ fontSize: '8px', fontWeight: 500, color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', letterSpacing: 'var(--tracking-eye)' }}>
          {sub}
        </span>
      )}
    </button>
  );
}
