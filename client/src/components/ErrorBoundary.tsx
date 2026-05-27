import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  label?: string;
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
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const { label, variant = 'card' } = this.props;
    const errorMessage = this.state.error?.message ?? 'An unexpected error occurred';

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--s-2)',
          background: variant === 'tab' ? 'transparent' : 'var(--bg-2)',
          border: variant === 'tab' ? 'none' : '1px solid var(--line-2)',
          borderRadius: 'var(--r-2)',
          color: 'var(--fg-2)',
          padding: variant === 'tab' ? 'var(--s-6)' : 'var(--s-4)',
          overflow: 'hidden',
          minHeight: 0,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span style={{ fontSize: 'var(--t-sm)', fontWeight: 500 }}>
          {label ? `"${label}" crashed` : 'Session crashed'}
        </span>
        <span style={{
          fontSize: 'var(--t-sm)',
          opacity: 0.8,
          textAlign: 'center',
          maxWidth: 360,
          wordBreak: 'break-word',
        }}>
          {errorMessage}
        </span>
        <button
          onClick={this.handleReset}
          style={{
            marginTop: 'var(--s-1)',
            padding: 'var(--s-1) var(--s-3)',
            border: '1px solid var(--line-3)',
            borderRadius: 'var(--r-2)',
            background: 'transparent',
            color: 'var(--fg-1)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            letterSpacing: 'var(--tracking-eye)',
            textTransform: 'uppercase',
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
