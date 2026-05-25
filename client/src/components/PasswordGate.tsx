import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api, setToken } from '../services/api.js';
import { reconnectSocket } from '../hooks/useSocket.js';

interface PasswordGateProps {
  onAuthenticated: () => void;
}

export function PasswordGate({ onAuthenticated }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const { token } = await api.login(password);
      setToken(token);
      reconnectSocket();
      // On mobile, reload so iOS recalculates safe-area-inset-top for the header
      // (viewport meta now prevents zoom from persisting across the reload)
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
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-base)',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '360px',
          margin: '0 var(--space-4)',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-base)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-8)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <h1
          style={{
            margin: '0 0 var(--space-2)',
            fontSize: 'var(--text-xl)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          Remote Access
        </h1>
        <p
          style={{
            margin: '0 0 var(--space-6)',
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-muted)',
          }}
        >
          This session is password protected. Enter the password to continue.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label
              htmlFor="gate-password"
              style={{
                display: 'block',
                marginBottom: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="gate-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                placeholder="Enter password"
                style={{
                  width: '100%',
                  padding: '8px 36px 8px 12px',
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-base)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '16px',
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                background: 'var(--color-error-subtle)',
                border: '1px solid var(--color-error)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                marginBottom: 'var(--space-4)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-error)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              padding: '10px',
              background: loading || !password ? 'var(--color-bg-elevated)' : 'var(--color-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-base)',
              fontWeight: 500,
              color: loading || !password ? 'var(--color-text-muted)' : '#fff',
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              transition: 'background var(--transition-fast)',
            }}
          >
            {loading ? 'Verifying…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}
