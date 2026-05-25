import { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useNgrok } from '../../hooks/useNgrok.js';
import { useSocket } from '../../hooks/useSocket.js';

interface MobileRemoteAccessProps {
  onBack: () => void;
}

export function MobileRemoteAccess({ onBack }: MobileRemoteAccessProps) {
  const socket = useSocket();
  const { status, loading, error, startTunnel, stopTunnel } = useNgrok(socket);

  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const isConnected = status?.tunnelStatus === 'connected';
  const mobileUrl = isConnected && status?.publicUrl ? `${status.publicUrl}/mobile` : null;

  const copyLink = () => {
    if (!mobileUrl) return;

    navigator.clipboard.writeText(mobileUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: focus the read-only input
      if (fallbackInputRef.current) {
        fallbackInputRef.current.select();
      }
    });
  };

  const handleStart = () => {
    if (password.length < 4) return;
    startTunnel(password);
    setPassword('');
  };

  const handlePasswordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleStart();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: '#1C1C1E',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Nav bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          height: 52,
          background: 'rgba(28,28,30,0.98)',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          gap: 8,
        } as React.CSSProperties}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#0A84FF',
            fontSize: 15,
            padding: '4px 4px 4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
          }}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
            <path d="M8 14L2 8L8 2" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>

        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 17,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.88)',
          }}
        >
          Remote Access
        </div>

        {/* Spacer to balance the back button */}
        <div style={{ width: 56, flexShrink: 0 }} />
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '20px 16px',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        } as React.CSSProperties}
      >
        {/* Status card */}
        <div
          style={{
            background: '#161618',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
            border: '0.5px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isConnected && mobileUrl ? 10 : 0 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isConnected ? '#30D158' : 'rgba(255,255,255,0.3)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: isConnected ? '#30D158' : 'rgba(255,255,255,0.45)',
              }}
            >
              {isConnected ? 'Tunnel active' : 'No tunnel'}
            </span>
          </div>

          {isConnected && mobileUrl && (
            <div
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.45)',
                fontFamily: 'ui-monospace, monospace',
                wordBreak: 'break-all',
                marginTop: 4,
              }}
            >
              {mobileUrl}
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div
            style={{
              background: 'rgba(255,69,58,0.12)',
              border: '1px solid rgba(255,69,58,0.3)',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 14,
              color: '#FF453A',
            }}
          >
            {error}
          </div>
        )}

        {/* QR code — only when connected */}
        {isConnected && mobileUrl && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  background: '#fff',
                  padding: 16,
                  borderRadius: 16,
                  display: 'inline-flex',
                  boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
                }}
              >
                <QRCodeSVG value={mobileUrl} size={160} bgColor="#fff" fgColor="#000" />
              </div>
            </div>

            <p
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: 'rgba(255,255,255,0.28)',
                margin: '0 0 16px',
                lineHeight: 1.5,
              }}
            >
              Scan to open Argus on any device.{'\n'}Protected by your password.
            </p>

            {/* Copy link button */}
            <button
              onClick={copyLink}
              style={{
                width: '100%',
                background: copied ? 'rgba(48,209,88,0.12)' : 'rgba(10,132,255,0.12)',
                color: copied ? '#30D158' : '#0A84FF',
                border: `1px solid ${copied ? 'rgba(48,209,88,0.3)' : 'rgba(10,132,255,0.3)'}`,
                borderRadius: 10,
                padding: '11px 16px',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: 8,
                fontFamily: 'inherit',
                transition: 'all 0.2s',
              }}
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>

            {/* Fallback read-only input (shown on clipboard error) */}
            <input
              ref={fallbackInputRef}
              type="text"
              readOnly
              value={mobileUrl}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                color: 'rgba(255,255,255,0.45)',
                fontFamily: 'ui-monospace, monospace',
                boxSizing: 'border-box',
                marginBottom: 16,
              }}
            />
          </>
        )}

        {/* Start tunnel form — only when not connected */}
        {!isConnected && (
          <div
            style={{
              background: '#161618',
              borderRadius: 14,
              padding: '16px',
              marginBottom: 16,
              border: '0.5px solid rgba(255,255,255,0.08)',
            }}
          >
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 14,
                color: 'rgba(255,255,255,0.45)',
                lineHeight: 1.5,
              }}
            >
              Start a tunnel to access Argus remotely. Set a password to protect access.
            </p>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handlePasswordKeyDown}
              placeholder="Set access password..."
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 15,
                color: 'rgba(255,255,255,0.88)',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 12,
                fontFamily: 'inherit',
              }}
            />

            {password.length > 0 && password.length < 4 && (
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#FF453A' }}>
                Password must be at least 4 characters
              </p>
            )}
          </div>
        )}

        {/* Action button */}
        {isConnected ? (
          <button
            onClick={() => stopTunnel()}
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? 'rgba(255,69,58,0.08)' : 'rgba(255,69,58,0.12)',
              color: '#FF453A',
              border: '1px solid rgba(255,69,58,0.3)',
              borderRadius: 10,
              padding: '11px 16px',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              fontFamily: 'inherit',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Stopping…' : 'Stop Tunnel'}
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={loading || password.length < 4}
            style={{
              width: '100%',
              background:
                loading || password.length < 4 ? 'rgba(10,132,255,0.2)' : '#0A84FF',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '11px 16px',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading || password.length < 4 ? 'default' : 'pointer',
              fontFamily: 'inherit',
              opacity: loading || password.length < 4 ? 0.5 : 1,
            }}
          >
            {loading ? 'Starting…' : 'Start Tunnel'}
          </button>
        )}

        {/* Not installed warning */}
        {status && !status.installed && (
          <div
            style={{
              marginTop: 16,
              background: 'rgba(255,69,58,0.08)',
              border: '1px solid rgba(255,69,58,0.2)',
              borderRadius: 10,
              padding: '12px 14px',
              fontSize: 13,
              color: 'rgba(255,255,255,0.45)',
            }}
          >
            ngrok is not installed on the host machine. Install it on your Mac to enable remote access.
          </div>
        )}
      </div>
    </div>
  );
}
