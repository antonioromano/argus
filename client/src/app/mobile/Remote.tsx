import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronLeft, Wifi, WifiOff, AlertTriangle, Copy, Check } from 'lucide-react';
import { useNgrok } from '../../hooks/useNgrok.js';
import { useSocket } from '../../hooks/useSocket.js';
import { Button, StatusDot, TextInput, Field } from '../../components/primitives/index.js';

interface RemoteProps {
  onBack: () => void;
}

export function Remote({ onBack }: RemoteProps) {
  const socket = useSocket();
  const { status, loading, error, startTunnel, stopTunnel } = useNgrok(socket);

  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const connected = status?.tunnelStatus === 'connected';
  const mobileUrl = connected && status?.publicUrl ? `${status.publicUrl}/mobile` : null;

  const copyLink = () => {
    if (!mobileUrl) return;
    navigator.clipboard.writeText(mobileUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--s-3)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          minHeight: 52,
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
          gap: 'var(--s-2)',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: '1px solid var(--line-2)',
            cursor: 'pointer',
            color: 'var(--accent)',
            borderRadius: 'var(--r-2)',
            padding: '0 12px',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            letterSpacing: 'var(--tracking-eye)',
            textTransform: 'uppercase',
          }}
        >
          <ChevronLeft size={14} strokeWidth={1.6} /> BACK
        </button>
        <div className="eyebrow" style={{ flex: 1, textAlign: 'center', fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>
          REMOTE ACCESS
        </div>
        <div style={{ width: 64 }} />
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
          padding: 'var(--s-5) var(--s-4)',
        }}
      >
        <div
          style={{
            background: 'var(--bg-2)',
            borderRadius: 'var(--r-3)',
            padding: 'var(--s-3) var(--s-4)',
            marginBottom: 'var(--s-4)',
            border: '1px solid var(--line-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
            {connected ? (
              <>
                <StatusDot status="running" size={8} />
                <Wifi size={14} strokeWidth={1.6} color="var(--accent)" />
                <span className="eyebrow" style={{ color: 'var(--accent)' }}>TUNNEL ACTIVE</span>
              </>
            ) : (
              <>
                <WifiOff size={14} strokeWidth={1.6} color="var(--fg-3)" />
                <span className="eyebrow">NO TUNNEL</span>
              </>
            )}
          </div>
          {mobileUrl && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                color: 'var(--fg-2)',
                wordBreak: 'break-all',
                marginTop: 'var(--s-2)',
              }}
            >
              {mobileUrl}
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--danger-bg)',
              border: '1px solid color-mix(in srgb, var(--danger) 33%, transparent)',
              borderRadius: 'var(--r-2)',
              padding: '10px var(--s-3)',
              marginBottom: 'var(--s-4)',
              fontSize: 'var(--t-sm)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--danger)',
            }}
          >
            <AlertTriangle size={12} strokeWidth={1.6} />
            {error}
          </div>
        )}

        {connected && mobileUrl && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s-4)' }}>
              <div style={{ background: '#fff', padding: 'var(--s-4)', borderRadius: 'var(--r-3)', boxShadow: 'var(--shadow-pop)' }}>
                <QRCodeSVG value={mobileUrl} size={160} bgColor="#fff" fgColor="#000" />
              </div>
            </div>
            <Button variant={copied ? 'primary' : 'outline'} full icon={copied ? Check : Copy} onClick={copyLink}>
              {copied ? 'Copied' : 'Copy Link'}
            </Button>
          </>
        )}

        {!connected && (
          <div
            style={{
              background: 'var(--bg-2)',
              borderRadius: 'var(--r-3)',
              padding: 'var(--s-4)',
              marginBottom: 'var(--s-4)',
              border: '1px solid var(--line-2)',
            }}
          >
            <Field
              label="Access password"
              error={password.length > 0 && password.length < 4 ? 'Min 4 characters' : undefined}
            >
              <TextInput
                value={password}
                onChange={setPassword}
                placeholder="Set access password..."
                type="password"
                mono
              />
            </Field>
          </div>
        )}

        {connected ? (
          <Button variant="danger" full disabled={loading} loading={loading} onClick={() => stopTunnel()}>
            Stop Tunnel
          </Button>
        ) : (
          <Button
            variant="primary"
            full
            disabled={loading || password.length < 4}
            loading={loading}
            onClick={() => startTunnel(password)}
          >
            Start Tunnel
          </Button>
        )}

        {status && !status.installed && (
          <div
            style={{
              marginTop: 'var(--s-4)',
              background: 'var(--warn-bg)',
              border: '1px solid color-mix(in srgb, var(--warn) 33%, transparent)',
              borderRadius: 'var(--r-2)',
              padding: 'var(--s-3) var(--s-3)',
              fontSize: 'var(--t-sm)',
              color: 'var(--warn)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
            }}
          >
            ngrok not installed on host machine.
          </div>
        )}
      </div>
    </div>
  );
}
