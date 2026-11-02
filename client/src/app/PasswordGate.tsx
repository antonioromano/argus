import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { api, setToken } from '../services/api.js';
import { reconnectSocket } from '../hooks/useSocket.js';
import { Button, Field, TextInput, Icon } from '../components/primitives/index.js';
import { useOverlaySuppression } from '../hooks/useOverlaySuppression.js';

interface PasswordGateProps {
  onAuthenticated: () => void;
}

export function PasswordGate({ onAuthenticated }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The caller (DesktopRoot) only renders PasswordGate in place of the whole
  // app while auth is unresolved — a real conditional mount, so a top-level
  // call is correct here.
  useOverlaySuppression('all');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const { token } = await api.login(password);
      setToken(token);
      reconnectSocket();
      if (window.innerWidth < 768) {
        window.location.reload();
      } else {
        onAuthenticated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="grid-bg scanline-bg"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-0)',
        zIndex: 'var(--z-overlay)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 380,
          margin: '0 var(--s-4)',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-4)',
          padding: 'var(--s-7)',
          boxShadow: 'var(--shadow-sheet)',
          animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s-1-5)',
            padding: 'var(--s-1) var(--s-2)',
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-edge)',
            borderRadius: 'var(--r-1)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            letterSpacing: 'var(--tracking-eye)',
            marginBottom: 'var(--s-4)',
          }}
        >
          <Icon icon={Lock} size="sm" /> REMOTE ACCESS
        </div>
        <h1
          style={{
            margin: '0 0 var(--s-2)',
            fontSize: 'var(--t-xl)',
            fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--fg-0)',
          }}
        >
          Authenticate
        </h1>
        <p style={{ margin: '0 0 var(--s-6)', fontSize: 'var(--t-sm)', color: 'var(--fg-2)', lineHeight: 1.5 }}>
          This Argus instance is exposed via a tunnel. Enter the shared password to continue.
        </p>

        <div style={{ marginBottom: 'var(--s-4)' }}>
          <Field label="Password">
            <div style={{ position: 'relative' }}>
              <TextInput
                value={password}
                onChange={setPassword}
                placeholder="Enter password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                mono
                autoFocus
                style={{ paddingRight: 'var(--s-7)', height: 36 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 'var(--s-0-5)',
                  color: 'var(--fg-3)',
                  display: 'flex',
                }}
              >
                {showPassword ? <Icon icon={EyeOff} size="md" /> : <Icon icon={Eye} size="md" />}
              </button>
            </div>
          </Field>
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-1-5)',
              background: 'var(--danger-bg)',
              border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
              borderRadius: 'var(--r-2)',
              padding: 'var(--s-2) var(--s-3)',
              marginBottom: 'var(--s-4)',
              fontSize: 'var(--t-sm)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--danger)',
            }}
          >
            <Icon icon={AlertTriangle} size="sm" />
            {error}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" full disabled={loading || !password} loading={loading}>
          Unlock
        </Button>
      </form>
    </div>
  );
}
