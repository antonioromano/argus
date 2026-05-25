import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { NgrokStatus } from '@argus/shared';
import { MacInput } from './primitives/index.js';

interface MacRemotePanelProps {
  isOpen: boolean;
  onClose: () => void;
  status: NgrokStatus | null;
  loading: boolean;
  error: string | null;
  onStart: (password: string) => void;
  onStop: () => void;
  onRecheck: () => void;
}

export function MacRemotePanel({
  isOpen,
  onClose,
  status,
  loading,
  error,
  onStart,
  onStop,
  onRecheck,
}: MacRemotePanelProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
  };

  const installInstructions = (platform: string) => {
    if (platform === 'darwin') {
      return {
        steps: [
          { label: 'Install via Homebrew', cmd: 'brew install ngrok/ngrok/ngrok' },
          { label: 'Add your auth token', cmd: 'ngrok config add-authtoken <your-token>' },
        ],
        link: 'https://dashboard.ngrok.com/get-started/your-authtoken',
        linkLabel: 'Get your auth token →',
      };
    }
    return {
      steps: [
        { label: 'Install via snap', cmd: 'snap install ngrok' },
        { label: 'Add your auth token', cmd: 'ngrok config add-authtoken <your-token>' },
      ],
      link: 'https://dashboard.ngrok.com/get-started/your-authtoken',
      linkLabel: 'Get your auth token →',
    };
  };

  const handleStart = () => {
    setPasswordError(null);
    if (password.length < 4) {
      setPasswordError('Password must be at least 4 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    onStart(password);
    setPassword('');
    setConfirmPassword('');
  };

  const isConnected = status?.tunnelStatus === 'connected';
  const isConnecting = status?.tunnelStatus === 'connecting' || loading;
  const isError = status?.tunnelStatus === 'error';

  return (
    // Outer container — always 300px wide, uses transform for slide animation
    <div
      style={{
        position: 'fixed',
        top: 'var(--toolbar-height, 52px)',
        right: 0,
        bottom: 0,
        zIndex: 160,
        width: 300,
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.2s ease',
        background: 'var(--color-bg-sheet, var(--color-bg-modal))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '0.5px solid var(--color-border-base)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
        // Prevent interaction when invisible
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--color-border-base)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          Remote Access
        </span>
        <button
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            border: 'none',
            background: 'none',
            borderRadius: 6,
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Status badge */}
        {status && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <StatusBadge status={status} />
          </div>
        )}

        {/* Hook-level error */}
        {error && <ErrorBox message={error} />}

        {/* Process-level error (from status) */}
        {isError && status?.error && !error && <ErrorBox message={status.error} />}

        {/* Not installed */}
        {status && !status.installed && (
          <NotInstalledView instructions={installInstructions(status.platform)} />
        )}

        {/* Connected */}
        {status?.installed && isConnected && status.publicUrl && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}
            >
              Public URL
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--color-bg-code)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                border: '1px solid var(--color-border-base)',
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: 'var(--color-success)',
                  flex: 1,
                  wordBreak: 'break-all',
                }}
              >
                {status.publicUrl}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button
                onClick={() => copyToClipboard(status.publicUrl!)}
                style={actionBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                Copy URL
              </button>
              <a
                href={status.publicUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  ...actionBtnStyle,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                Open ↗
              </a>
            </div>

            {/* QR code */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <div
                style={{
                  background: '#fff',
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  display: 'inline-flex',
                }}
              >
                <QRCodeSVG value={`${status.publicUrl}/mobile`} size={152} />
              </div>
            </div>

            <div
              style={{
                padding: '8px 10px',
                background: 'rgba(158,206,106,0.08)',
                border: '1px solid var(--color-success)',
                borderRadius: 'var(--radius-md)',
                fontSize: 11,
                color: 'var(--color-success)',
                marginBottom: 8,
              }}
            >
              This tunnel is password protected. Share the URL and password only with trusted collaborators.
            </div>

            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: 'var(--color-text-muted)',
              }}
            >
              Sleep prevention is active — your computer will stay awake while the tunnel is open.
            </p>
          </div>
        )}

        {/* Disconnected — show password form */}
        {status?.installed && !isConnected && !isConnecting && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-primary)',
              }}
            >
              Start an ngrok tunnel to access this dashboard remotely.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Password field */}
              <MacInput
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(v) => { setPassword(v); setPasswordError(null); }}
                placeholder="Set a password for remote access"
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    style={eyeButtonStyle}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              />

              {/* Confirm password field */}
              <MacInput
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(v) => { setConfirmPassword(v); setPasswordError(null); }}
                placeholder="Confirm password"
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    style={eyeButtonStyle}
                  >
                    {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              />

              {passwordError && <ErrorBox message={passwordError} />}
            </div>
          </div>
        )}

        {/* Connecting spinner state */}
        {isConnecting && !isConnected && (
          <p
            style={{
              margin: '0 0 12px',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            Connecting…
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--color-border-base)',
          flexShrink: 0,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={onClose}
          style={secondaryBtnStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-surface)'; }}
        >
          Close
        </button>

        {status?.installed ? (
          isConnected ? (
            <button
              onClick={onStop}
              disabled={loading}
              style={{
                ...dangerBtnStyle,
                opacity: loading ? 0.7 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Stopping…' : 'Stop Tunnel'}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isConnecting}
              style={{
                ...primaryBtnStyle,
                opacity: isConnecting ? 0.7 : 1,
                cursor: isConnecting ? 'not-allowed' : 'pointer',
              }}
            >
              {isConnecting ? 'Connecting…' : isError ? 'Retry' : 'Start Tunnel'}
            </button>
          )
        ) : (
          <button
            onClick={onRecheck}
            style={primaryBtnStyle}
          >
            Re-check Installation
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (ported from NgrokModal)
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: NgrokStatus }) {
  let label = 'Checking…';
  let color = 'var(--color-text-muted)';
  let bg = 'var(--color-bg-surface)';

  if (!status.installed) {
    label = 'Not Installed';
    color = 'var(--color-error)';
    bg = 'var(--color-error-subtle)';
  } else if (status.tunnelStatus === 'connected') {
    label = 'Connected';
    color = 'var(--color-success)';
    bg = 'rgba(158,206,106,0.12)';
  } else if (status.tunnelStatus === 'connecting') {
    label = 'Connecting…';
    color = 'var(--color-warning)';
    bg = 'var(--color-warning-bg)';
  } else if (status.tunnelStatus === 'error') {
    label = 'Error';
    color = 'var(--color-error)';
    bg = 'var(--color-error-subtle)';
  } else {
    label = 'Ready';
    color = 'var(--color-accent)';
    bg = 'var(--color-accent-subtle)';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color,
        background: bg,
      }}
    >
      {status.tunnelStatus === 'connected' && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-success)',
            display: 'inline-block',
          }}
        />
      )}
      {label}
    </span>
  );
}

function NotInstalledView({
  instructions,
}: {
  instructions: {
    steps: { label: string; cmd: string }[];
    link: string;
    linkLabel: string;
  };
}) {
  return (
    <>
      <p
        style={{
          margin: '0 0 var(--space-3)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
        }}
      >
        ngrok is required to create a public tunnel. Follow the steps below to install it.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 'var(--space-3)' }}>
        {instructions.steps.map((step, i) => (
          <div key={i}>
            <p
              style={{
                margin: '0 0 4px',
                fontSize: 11,
                color: 'var(--color-text-muted)',
              }}
            >
              {i + 1}. {step.label}
            </p>
            <div
              style={{
                background: 'var(--color-bg-code)',
                border: '1px solid var(--color-border-base)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 10px',
                fontFamily: 'monospace',
                fontSize: 11,
                color: 'var(--color-text-primary)',
                userSelect: 'all',
                wordBreak: 'break-all',
              }}
            >
              {step.cmd}
            </div>
          </div>
        ))}
      </div>

      <a
        href={instructions.link}
        target="_blank"
        rel="noreferrer"
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-accent)',
          display: 'block',
          marginBottom: 'var(--space-4)',
        }}
      >
        {instructions.linkLabel}
      </a>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      style={{
        background: 'var(--color-error-subtle)',
        border: '1px solid var(--color-error)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 10px',
        marginBottom: 'var(--space-3)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-error)',
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const eyeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 2,
  color: 'var(--color-text-muted)',
  display: 'flex',
};

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-base)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'background var(--transition-fast)',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'background var(--transition-fast)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-accent)',
  color: '#fff',
  cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-error)',
  color: '#fff',
  cursor: 'pointer',
};
