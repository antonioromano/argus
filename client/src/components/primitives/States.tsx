import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button.js';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: 'var(--s-8) var(--s-6)',
      gap: 'var(--s-3)',
      color: 'var(--fg-2)',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: '1px dashed var(--line-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-3)',
      }}>
        <Icon size={24} strokeWidth={1.6} />
      </div>
      <div style={{ fontSize: 'var(--t-md)', color: 'var(--fg-0)', fontWeight: 500 }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--t-sm)', maxWidth: 280 }}>{hint}</div>}
      {action}
    </div>
  );
}

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Connecting' }: LoadingStateProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--s-3)',
      color: 'var(--fg-2)',
    }}>
      <div style={{ display: 'inline-flex', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 16,
              background: 'var(--accent)',
              animation: `argus-pulse-bar 1.2s ease-in-out ${i * 0.12}s infinite`,
            }}
          />
        ))}
      </div>
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>
        {label}
        <span style={{ animation: 'argus-blink 1s infinite' }}>_</span>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Process exited', detail, onRetry }: ErrorStateProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--s-3)',
      padding: 'var(--s-6)',
      textAlign: 'center',
    }}>
      <div style={{
        padding: '6px var(--s-3)',
        background: 'var(--danger-bg)',
        color: 'var(--danger)',
        border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
        borderRadius: 'var(--r-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        letterSpacing: 'var(--tracking-eye)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <AlertTriangle size={12} strokeWidth={1.6} /> ERROR
      </div>
      <div style={{ fontSize: 'var(--t-md)', color: 'var(--fg-0)', fontWeight: 500 }}>{title}</div>
      {detail && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
          color: 'var(--fg-2)',
          background: 'var(--bg-inset)',
          padding: 'var(--s-2) var(--s-3)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-2)',
          maxWidth: 360,
          textAlign: 'left',
        }}>
          {detail}
        </div>
      )}
      {onRetry && <Button variant="outline" icon={RefreshCw} size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
