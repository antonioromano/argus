import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { UpdateStatus } from '@argus/shared';
import { MacSheet } from './MacSheet.js';
import { api } from '../../services/api.js';

interface MacUpdateSheetProps {
  status: UpdateStatus;
  onClose: () => void;
}

export function MacUpdateSheet({ status, onClose }: MacUpdateSheetProps) {
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
        setWarning(result.warning ?? 'You have local changes. Do you want to continue anyway?');
        setApplying(false);
        return;
      }
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply update');
      setApplying(false);
    }
  };

  const footer = applied ? (
    <button
      onClick={onClose}
      style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
    >
      Close
    </button>
  ) : warning ? (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button
        onClick={onClose}
        disabled={applying}
        style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)', opacity: applying ? 0.5 : 1 }}
      >
        Cancel
      </button>
      <button
        onClick={() => handleApply(true)}
        disabled={applying}
        style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: applying ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)', opacity: applying ? 0.6 : 1 }}
      >
        {applying ? 'Applying…' : 'Confirm and Continue'}
      </button>
    </div>
  ) : (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button
        onClick={onClose}
        disabled={applying}
        style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)', opacity: applying ? 0.5 : 1 }}
      >
        Not Now
      </button>
      <button
        onClick={() => handleApply()}
        disabled={applying}
        style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: applying ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)', opacity: applying ? 0.6 : 1 }}
      >
        {applying ? 'Applying…' : 'Update Now'}
      </button>
    </div>
  );

  return (
    <MacSheet
      isOpen
      title="Update Available"
      onClose={applying ? () => {} : onClose}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Version badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <VersionBadge label="Current" version={status.currentVersion} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 18 }}>→</span>
          <VersionBadge label="Latest" version={status.latestVersion ?? ''} highlight />
        </div>

        {/* Warning: restart notice */}
        <div style={{
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--color-warning-subtle, rgba(255,180,0,0.12))',
          border: '1px solid var(--color-warning, #f0a500)',
          color: 'var(--color-warning, #f0a500)',
          fontSize: 13,
        }}>
          This will restart the server and terminate all active sessions.
        </div>

        {/* Deps info */}
        {!applied && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
          }}>
            Dependencies will be installed automatically via <code style={{ fontFamily: 'monospace' }}>npm install</code> before the server restarts.
          </div>
        )}

        {/* Success state */}
        {applied && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--color-success-subtle, rgba(0,200,100,0.12))',
            border: '1px solid var(--color-success)',
            color: 'var(--color-success)',
            fontSize: 13,
          }}>
            <strong>Update applied!</strong> Installing dependencies and restarting — the page will reconnect automatically.
          </div>
        )}

        {/* Warning state (local changes) */}
        {warning && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--color-warning-subtle, rgba(255,180,0,0.12))',
            border: '1px solid var(--color-warning, #f0a500)',
            color: 'var(--color-warning, #f0a500)',
            fontSize: 13,
          }}>
            {warning}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(255,80,80,0.1)',
            border: '1px solid var(--color-error)',
            color: 'var(--color-error)',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Changelog */}
        {status.changelog && !applied && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              What's new
            </div>
            <div style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
              maxHeight: 220,
              overflowY: 'auto',
              padding: '10px 12px',
              background: 'var(--color-bg-surface)',
              borderRadius: 8,
              border: '1px solid var(--color-border-subtle)',
            }}>
              <ReactMarkdown>{status.changelog}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Release link */}
        {status.releaseUrl && !applied && (
          <a
            href={status.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: 'var(--color-accent)', textDecoration: 'none' }}
          >
            View release on GitHub ↗
          </a>
        )}
      </div>
    </MacSheet>
  );
}

function VersionBadge({ label, version, highlight }: { label: string; version: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{
        fontSize: 15,
        fontWeight: 600,
        fontFamily: 'monospace',
        padding: '4px 10px',
        borderRadius: 100,
        background: highlight ? 'var(--color-success-subtle, rgba(0,200,100,0.12))' : 'var(--color-bg-surface)',
        color: highlight ? 'var(--color-success)' : 'var(--color-text-primary)',
        border: `1px solid ${highlight ? 'var(--color-success)' : 'var(--color-border-subtle)'}`,
      }}>
        v{version}
      </span>
    </div>
  );
}
