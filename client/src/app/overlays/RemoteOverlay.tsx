import { useState } from 'react';
import type { NgrokStatus } from '@argus/shared';
import { QRCodeSVG } from 'qrcode.react';
import { Wifi, WifiOff, Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  Sheet,
  Field,
  TextInput,
  Button,
  StatusDot,
} from '../../components/primitives/index.js';

interface RemoteOverlayProps {
  status: NgrokStatus | null;
  loading: boolean;
  error: string | null;
  onStart: (password: string) => void;
  onStop: () => void;
  onClose: () => void;
}

export function RemoteOverlay({ status, loading, error, onStart, onStop, onClose }: RemoteOverlayProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connected = status?.tunnelStatus === 'connected';
  const publicUrl = connected ? status?.publicUrl ?? null : null;

  const handleStart = () => {
    if (password.length < 4) {
      setPwErr('Min 4 characters');
      return;
    }
    if (password !== confirmPassword) {
      setPwErr('Passwords do not match');
      return;
    }
    setPwErr(null);
    onStart(password);
    setPassword('');
    setConfirmPassword('');
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <Sheet
      eyebrow="ARGUS · REMOTE"
      title={connected ? 'Tunnel active' : 'Start tunnel'}
      subtitle="Expose Argus over ngrok. Password protected."
      width={520}
      onClose={onClose}
      footer={
        connected ? (
          <>
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button variant="danger" onClick={onStop} loading={loading} disabled={loading}>Stop tunnel</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleStart}
              loading={loading}
              disabled={loading || password.length < 4 || password !== confirmPassword}
            >
              Start tunnel
            </Button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-2)',
            padding: 'var(--s-3) var(--s-4)',
            background: 'var(--bg-1)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
          }}
        >
          {connected ? (
            <>
              <StatusDot status="running" size={8} />
              <Wifi size={14} strokeWidth={1.6} color="var(--accent)" />
              <span className="eyebrow" style={{ color: 'var(--accent)' }}>ACTIVE</span>
            </>
          ) : (
            <>
              <WifiOff size={14} strokeWidth={1.6} color="var(--fg-3)" />
              <span className="eyebrow">OFFLINE</span>
            </>
          )}
          {status && !status.installed && (
            <span className="eyebrow" style={{ color: 'var(--warn)' }}>NGROK NOT INSTALLED</span>
          )}
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px var(--s-3)',
              background: 'var(--danger-bg)',
              border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
              borderRadius: 'var(--r-2)',
              color: 'var(--danger)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
            }}
          >
            <AlertTriangle size={12} strokeWidth={1.6} />
            {error}
          </div>
        )}

        {connected && publicUrl && (
          <>
            <Field label="Public URL">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  padding: '6px var(--s-3)',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r-2)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-sm)',
                    color: 'var(--accent)',
                    flex: 1,
                    wordBreak: 'break-all',
                  }}
                >
                  {publicUrl}
                </span>
                <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={() => copy(publicUrl)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="eyebrow"
                  style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <ExternalLink size={11} strokeWidth={1.6} /> OPEN
                </a>
              </div>
            </Field>

            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-3)' }}>
              <div
                style={{
                  background: '#fff',
                  padding: 'var(--s-3)',
                  borderRadius: 'var(--r-3)',
                  boxShadow: 'var(--shadow-pop)',
                }}
              >
                <QRCodeSVG value={`${publicUrl}/mobile`} size={160} bgColor="#fff" fgColor="#000" />
              </div>
            </div>
            <p className="eyebrow" style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
              SCAN TO OPEN MOBILE COMPANION
            </p>
          </>
        )}

        {!connected && (
          <>
            <Field label="Password" required hint="Min 4 characters" error={pwErr ?? undefined}>
              <TextInput
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="Set password"
                mono
              />
            </Field>
            <Field label="Confirm password" required>
              <TextInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                type="password"
                placeholder="Re-enter password"
                mono
                onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
              />
            </Field>
          </>
        )}
      </div>
    </Sheet>
  );
}
