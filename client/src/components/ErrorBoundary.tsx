import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  /** Used for contextual error messages (e.g. session name) */
  label?: string;
  /** 'tab' for full-area fallback, 'card' for card-sized fallback (default: 'card') */
  variant?: 'tab' | 'card';
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const { label, variant = 'card' } = this.props;
    const errorMessage = this.state.error?.message ?? 'An unexpected error occurred';

    if (variant === 'tab') {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--space-3)',
          color: 'var(--color-text-muted)',
          padding: 'var(--space-6)',
        }}>
          <span style={{ fontSize: 'var(--text-md)' }}>
            {label ? `"${label}" crashed` : 'This panel crashed'}
          </span>
          <span style={{ fontSize: 'var(--text-sm)', opacity: 0.7, maxWidth: 400, textAlign: 'center' }}>
            {errorMessage}
          </span>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    // 'card' variant — preserves grid card dimensions
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-muted)',
        padding: 'var(--space-4)',
        overflow: 'hidden',
        minHeight: 0,
      }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
          {label ? `"${label}" crashed` : 'Session crashed'}
        </span>
        <span style={{
          fontSize: 'var(--text-xs)',
          opacity: 0.7,
          textAlign: 'center',
          maxWidth: 300,
          wordBreak: 'break-word',
        }}>
          {errorMessage}
        </span>
        <button
          onClick={this.handleReset}
          style={{
            marginTop: 'var(--space-1)',
            padding: 'var(--space-1) var(--space-3)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
