import { useState } from 'react';
import type { NgrokStatus } from '@argus/shared';
import { QRCodeSVG } from 'qrcode.react';
import { Wifi, WifiOff, Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  Sheet,
  Field,
  Button,
  StatusDot,
  PasswordFields,
  NGROK_PW_MIN,
  isNgrokPasswordValid,
  Icon,
  Stack,
  Row,
  Text,
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
    if (!isNgrokPasswordValid(password)) {
      setPwErr(`Min ${NGROK_PW_MIN} characters`);
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
              disabled={loading || !isNgrokPasswordValid(password) || password !== confirmPassword}
            >
              Start tunnel
            </Button>
          </>
        )
      }
    >
      <Stack gap={4}>
        <Row
          gap={2}
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'var(--bg-1)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
          }}
        >
          {connected ? (
            <>
              <StatusDot status="running" size={8} />
              <Icon icon={Wifi} size="md" color="var(--accent)" />
              <span className="eyebrow" style={{ color: 'var(--accent)' }}>ACTIVE</span>
            </>
          ) : (
            <>
              <Icon icon={WifiOff} size="md" color="var(--fg-3)" />
              <span className="eyebrow">OFFLINE</span>
            </>
          )}
          {status && !status.installed && (
            <span className="eyebrow" style={{ color: 'var(--warn)' }}>NGROK NOT INSTALLED</span>
          )}
        </Row>

        {error && (
          <Row
            gap={1.5}
            style={{
              padding: 'var(--s-3)',
              background: 'var(--danger-bg)',
              border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
              borderRadius: 'var(--r-2)',
              color: 'var(--danger)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
            }}
          >
            <Icon icon={AlertTriangle} size="sm" />
            {error}
          </Row>
        )}

        {connected && publicUrl && (
          <>
            <Field label="Public URL">
              <Row
                gap={2}
                style={{
                  padding: 'var(--s-1-5) var(--s-3)',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r-2)',
                }}
              >
                <Text mono size="body" tone="accent" style={{ flex: 1, wordBreak: 'break-all' }}>
                  {publicUrl}
                </Text>
                <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={() => copy(publicUrl)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="eyebrow"
                  style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 'var(--s-1)' }}
                >
                  <Icon icon={ExternalLink} size="sm" /> OPEN
                </a>
              </Row>
            </Field>

            <Row align="stretch" justify="center" style={{ padding: 'var(--s-3)' }}>
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
            </Row>
            <p className="eyebrow" style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
              SCAN TO OPEN MOBILE COMPANION
            </p>
          </>
        )}

        {!connected && (
          <PasswordFields
            password={password}
            confirmPassword={confirmPassword}
            onPassword={setPassword}
            onConfirm={setConfirmPassword}
            onSubmit={handleStart}
            error={pwErr ?? undefined}
          />
        )}
      </Stack>
    </Sheet>
  );
}
