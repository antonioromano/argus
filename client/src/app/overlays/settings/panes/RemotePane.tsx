import { useState } from 'react';
import type { NgrokStatus } from '@argus/shared';
import { QRCodeSVG } from 'qrcode.react';
import { Wifi, WifiOff, Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  Section,
  SettingRow,
  Button,
  StatusDot,
  PasswordFields,
  NGROK_PW_MIN,
  isNgrokPasswordValid,
} from '../../../../components/primitives/index.js';

interface RemotePaneProps {
  ngrokStatus: NgrokStatus | null;
  ngrokLoading: boolean;
  ngrokError: string | null;
  onNgrokStart: (password: string) => void;
  onNgrokStop: () => void;
}

export function RemotePane({ ngrokStatus, ngrokLoading, ngrokError, onNgrokStart, onNgrokStop }: RemotePaneProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connected = ngrokStatus?.tunnelStatus === 'connected';
  const publicUrl = connected ? ngrokStatus?.publicUrl ?? null : null;

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
    onNgrokStart(password);
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
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-3) var(--s-4)',
          marginBottom: 'var(--s-4)',
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
        {ngrokStatus && !ngrokStatus.installed && (
          <span className="eyebrow" style={{ color: 'var(--warn)' }}>NGROK NOT INSTALLED</span>
        )}
        {connected && (
          <>
            <div style={{ flex: 1 }} />
            <Button variant="danger" size="sm" onClick={onNgrokStop} loading={ngrokLoading} disabled={ngrokLoading}>
              Stop tunnel
            </Button>
          </>
        )}
      </div>

      {ngrokError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px var(--s-3)',
            marginBottom: 'var(--s-4)',
            background: 'var(--danger-bg)',
            border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
            borderRadius: 'var(--r-2)',
            color: 'var(--danger)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-sm)',
          }}
        >
          <AlertTriangle size={12} strokeWidth={1.6} />
          {ngrokError}
        </div>
      )}

      {connected && publicUrl && (
        <Section title="Public URL">
          <SettingRow trailing>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', width: '100%' }}>
              <span
                className="mono"
                style={{ flex: 1, fontSize: 'var(--t-sm)', color: 'var(--accent)', wordBreak: 'break-all' }}
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
          </SettingRow>
          <SettingRow label="Mobile companion" hint="Scan to open the read-only companion on your phone">
            <div
              style={{
                background: '#fff',
                padding: 'var(--s-2)',
                borderRadius: 'var(--r-3)',
                boxShadow: 'var(--shadow-pop)',
                lineHeight: 0,
              }}
            >
              <QRCodeSVG value={`${publicUrl}/mobile`} size={116} bgColor="#fff" fgColor="#000" />
            </div>
          </SettingRow>
        </Section>
      )}

      {!connected && (
        <Section title="Start a tunnel">
          <div className="settings-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
            <PasswordFields
              password={password}
              confirmPassword={confirmPassword}
              onPassword={setPassword}
              onConfirm={setConfirmPassword}
              onSubmit={handleStart}
              error={pwErr ?? undefined}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                onClick={handleStart}
                loading={ngrokLoading}
                disabled={ngrokLoading || !isNgrokPasswordValid(password) || password !== confirmPassword}
              >
                Start tunnel
              </Button>
            </div>
          </div>
        </Section>
      )}
    </>
  );
}
