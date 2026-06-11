import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { UpdateStatus } from '@argus/shared';
import { ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Sheet, Button, Kbd } from '../../components/primitives/index.js';
import { api } from '../../services/api.js';

interface UpdateSheetProps {
  status: UpdateStatus;
  onClose: () => void;
}

export function UpdateSheet({ status, onClose }: UpdateSheetProps) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const handleApply = async (force = false) => {
    setApplying(true);
    setError(null);
    if (!force) setWarning(null);
    try {
      const result = await api.applyUpdate(force);
      if (result.requiresConfirmation) {
        setWarning(result.warning ?? 'You have local changes. Continue anyway?');
        setApplying(false);
        return;
      }
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setApplying(false);
    }
  };

  const footer = applied ? (
    <Button onClick={onClose} variant="outline">Close</Button>
  ) : warning ? (
    <>
      <Button onClick={onClose} disabled={applying} variant="outline">Cancel</Button>
      <Button onClick={() => handleApply(true)} disabled={applying} loading={applying} variant="primary">
        Confirm and continue
      </Button>
    </>
  ) : (
    <>
      <Button onClick={onClose} disabled={applying} variant="outline">
        Not now <span style={{ marginLeft: 6 }}><Kbd>esc</Kbd></span>
      </Button>
      <Button onClick={() => handleApply()} disabled={applying} loading={applying} variant="primary">
        Update now
      </Button>
    </>
  );

  return (
    <Sheet
      eyebrow="UPDATE AVAILABLE"
      title={`Argus v${status.latestVersion ?? ''}`}
      width={520}
      onClose={applying ? () => {} : onClose}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <Badge label="Current" version={status.currentVersion} />
          <ArrowRight size={16} strokeWidth={1.6} color="var(--fg-3)" />
          <Badge label="Latest" version={status.latestVersion ?? ''} highlight />
        </div>

        <Notice kind="warn" icon={AlertTriangle}>
          Argus will close and all active sessions will end. It relaunches automatically once the new version is installed.
        </Notice>

        {!applied && (
          <Notice kind="info">
            The new version is installed via Homebrew (<code className="mono">brew upgrade --cask argus</code>). Requires Homebrew on your PATH.
          </Notice>
        )}

        {applied && (
          <Notice kind="ok" icon={CheckCircle2}>
            <strong>Updating via Homebrew…</strong> Argus will relaunch shortly.
          </Notice>
        )}

        {warning && <Notice kind="warn" icon={AlertTriangle}>{warning}</Notice>}
        {error && <Notice kind="danger" icon={AlertTriangle}>{error}</Notice>}

        {status.changelog && !applied && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>WHAT'S NEW</div>
            <div
              className="argus-scroll mono"
              style={{
                fontSize: 'var(--t-sm)',
                color: 'var(--fg-1)',
                lineHeight: 1.6,
                maxHeight: 220,
                overflowY: 'auto',
                padding: 'var(--s-3)',
                background: 'var(--bg-2)',
                borderRadius: 'var(--r-2)',
                border: '1px solid var(--line-2)',
              }}
            >
              <ReactMarkdown>{status.changelog}</ReactMarkdown>
            </div>
          </div>
        )}

        {status.releaseUrl && !applied && (
          <a
            href={status.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="eyebrow"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            VIEW RELEASE ON GITHUB ↗
          </a>
        )}
      </div>
    </Sheet>
  );
}

function Badge({ label, version, highlight }: { label: string; version: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span className="eyebrow">{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-md)',
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 'var(--r-2)',
          background: highlight ? 'var(--accent-bg)' : 'var(--bg-1)',
          color: highlight ? 'var(--accent)' : 'var(--fg-0)',
          border: `1px solid ${highlight ? 'var(--accent-edge)' : 'var(--line-2)'}`,
        }}
      >
        v{version}
      </span>
    </div>
  );
}

function Notice({
  kind,
  icon: Icon,
  children,
}: {
  kind: 'warn' | 'info' | 'ok' | 'danger';
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
  children: React.ReactNode;
}) {
  const palette = {
    warn:   { bg: 'var(--warn-bg)',   fg: 'var(--warn)',   border: 'color-mix(in srgb, var(--warn) 33%, transparent)' },
    info:   { bg: 'var(--bg-1)',      fg: 'var(--fg-1)',   border: 'var(--line-2)' },
    ok:     { bg: 'var(--accent-bg)', fg: 'var(--accent)', border: 'var(--accent-edge)' },
    danger: { bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'color-mix(in srgb, var(--danger) 44%, transparent)' },
  }[kind];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px var(--s-3)',
        borderRadius: 'var(--r-2)',
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        fontSize: 'var(--t-sm)',
        fontFamily: 'var(--font-mono)',
        lineHeight: 1.5,
      }}
    >
      {Icon && <Icon size={14} strokeWidth={1.6} color={palette.fg} />}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
