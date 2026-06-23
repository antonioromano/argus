import type { ReactNode, CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

export function HRule() {
  return <div style={{ height: 1, background: 'var(--line-2)' }} />;
}

export function VRule() {
  return <div style={{ width: 1, background: 'var(--line-2)', alignSelf: 'stretch' }} />;
}

interface SectionProps {
  title?: string;
  action?: ReactNode;
  /** When true, children are rendered directly without the card chrome (advanced layouts). */
  bare?: boolean;
  children?: ReactNode;
}

/**
 * Grouped-card section (macOS System Settings pattern): a small, quiet title sits
 * above a single rounded card that contains the rows. Replaces the old per-section
 * eyebrow-header + bottom-hairline treatment that read as noise when stacked.
 */
export function Section({ title, action, bare, children }: SectionProps) {
  return (
    <section className="settings-group">
      {(title || action) && (
        <div className="settings-group-head">
          {title && <span className="settings-group-title">{title}</span>}
          {action}
        </div>
      )}
      {bare ? children : <div className="settings-card">{children}</div>}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 18,
      height: 18,
      padding: '0 5px',
      background: 'var(--bg-1)',
      border: '1px solid var(--line-2)',
      borderRadius: 'var(--r-1)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--t-tiny)',
      color: 'var(--fg-1)',
      boxShadow: '0 1px 0 var(--line-2)',
    }}>
      {children}
    </span>
  );
}

interface ChipProps {
  children?: ReactNode;
  icon?: LucideIcon;
  dot?: string;
  onRemove?: () => void;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function Chip({ children, icon: Icon, dot, onRemove, active, onClick, style }: ChipProps) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px var(--s-2)',
        background: active ? 'var(--accent-bg)' : 'var(--bg-1)',
        color: active ? 'var(--accent)' : 'var(--fg-1)',
        border: `1px solid ${active ? 'var(--accent-edge)' : 'var(--line-2)'}`,
        borderRadius: 'var(--r-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        lineHeight: 1,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot }} />}
      {Icon && <Icon size={11} strokeWidth={1.6} />}
      {children}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ cursor: 'pointer', opacity: 0.6, display: 'inline-flex' }}
        >
          <X size={10} strokeWidth={1.6} />
        </span>
      )}
    </span>
  );
}
