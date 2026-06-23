import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { UpdateStatus, UpdateProgress } from '@argus/shared';
import { ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { Sheet, Button, Kbd } from '../../components/primitives/index.js';
import { api } from '../../services/api.js';
import type { UpdateFailure } from '../../hooks/useUpdate.js';

interface UpdateSheetProps {
  status: UpdateStatus;
  progress: UpdateProgress | null;
  failure: UpdateFailure | null;
  onResetState: () => void;
  onClose: () => void;
}

export function UpdateSheet({ status, progress, failure, onResetState, onClose }: UpdateSheetProps) {
  // `submitting` = HTTP apply in flight (fast). `started` = download began and
  // socket progress events now drive the bar. Terminal outcomes arrive as props:
  // `failure` (incl. up-to-date) or, on success, the app quits + relaunches.
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // While the download/install runs the app is on its way out — lock the sheet.
  // A failure unlocks it so the user can retry or close.
  const inFlight = (started || !!progress) && !failure;
  const showProgress = inFlight;

  const handleApply = async (force = false) => {
    setSubmitting(true);
    setStarted(false);
    onResetState();
    if (!force) setWarning(null);
    try {
      const result = await api.applyUpdate(force);
      if (result.requiresConfirmation) {
        setWarning(result.warning ?? 'You have local changes. Continue anyway?');
        return;
      }
      // success === "download started"; failure (e.g. brew missing) also arrives
      // as an `update:failed` socket event, surfaced via the `failure` prop.
      if (result.success) setStarted(true);
    } catch {
      // Network/HTTP error reaching the server — surface a generic message.
      setStarted(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setWarning(null);
    setStarted(false);
    onResetState();
    void handleApply();
  };

  const footer = failure ? (
    <>
      <Button onClick={onClose} variant="outline">Close</Button>
      {!failure.upToDate && (
        <Button onClick={handleRetry} variant="primary">Try again</Button>
      )}
    </>
  ) : inFlight ? (
    <Button onClick={onClose} disabled variant="outline">Updating…</Button>
  ) : warning ? (
    <>
      <Button onClick={onClose} disabled={submitting} variant="outline">Cancel</Button>
      <Button onClick={() => handleApply(true)} disabled={submitting} loading={submitting} variant="primary">
        Confirm and continue
      </Button>
    </>
  ) : (
    <>
      <Button onClick={onClose} disabled={submitting} variant="outline">
        Not now <span style={{ marginLeft: 6 }}><Kbd>esc</Kbd></span>
      </Button>
      <Button onClick={() => handleApply()} disabled={submitting} loading={submitting} variant="primary">
        Update now
      </Button>
    </>
  );

  return (
    <Sheet
      eyebrow="UPDATE AVAILABLE"
      title={`Argus v${status.latestVersion ?? ''}`}
      width={520}
      onClose={inFlight ? () => {} : onClose}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <Badge label="Current" version={status.currentVersion} />
          <ArrowRight size={16} strokeWidth={1.6} color="var(--fg-3)" />
          <Badge label="Latest" version={status.latestVersion ?? ''} highlight />
        </div>

        {!showProgress && !failure && (
          <>
            <Notice kind="warn" icon={AlertTriangle}>
              Argus will close and all active sessions will end — but only once the new version has finished downloading. It relaunches automatically.
            </Notice>
            <Notice kind="info">
              Installed via Homebrew (<code className="mono">brew upgrade --cask argus</code>). Requires Homebrew on your PATH.
            </Notice>
          </>
        )}

        {/* Progress region — fixed min-height so success/error states don't reflow the sheet. */}
        {showProgress && (
          <div style={{ minHeight: 64 }}>
            <ProgressBar progress={progress} />
          </div>
        )}

        {failure && (
          failure.upToDate ? (
            <Notice kind="info" icon={Info}>{failure.error}</Notice>
          ) : (
            <Notice kind="danger" icon={AlertTriangle}>
              <strong>Update failed.</strong>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{failure.error}</div>
            </Notice>
          )
        )}

        {warning && <Notice kind="warn" icon={AlertTriangle}>{warning}</Notice>}

        {status.changelog && !showProgress && !failure && (
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

        {status.releaseUrl && !showProgress && (
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

function ProgressBar({ progress }: { progress: UpdateProgress | null }) {
  const label = progress?.label ?? 'Starting…';
  const pct = progress?.percent;
  const determinate = typeof pct === 'number';
  const installing = progress?.phase === 'install';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        className="mono"
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--t-sm)', color: 'var(--fg-1)' }}
      >
        <span>{label}</span>
        {determinate && <span style={{ color: 'var(--fg-3)' }}>{Math.round(pct!)}%</span>}
      </div>
      <div
        style={{
          position: 'relative',
          height: 8,
          borderRadius: 999,
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            // Determinate: width tracks percent. Indeterminate (no percent yet, or
            // installing): full bar with a subtle pulse so it never looks stalled.
            width: determinate ? `${pct}%` : '100%',
            background: 'var(--accent)',
            borderRadius: 999,
            transition: 'width 0.25s ease',
            animation: determinate ? undefined : 'argus-pulse 1.2s ease-in-out infinite',
            opacity: installing && !determinate ? 0.8 : 1,
          }}
        />
      </div>
      <style>{'@keyframes argus-pulse { 0%,100% { opacity: 0.45 } 50% { opacity: 1 } }'}</style>
    </div>
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
