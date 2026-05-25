import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { UpdateStatus } from '@argus/shared';
import { Modal } from './primitives/Modal.js';
import { Button } from './primitives/Button.js';
import { api } from '../services/api.js';

interface UpdateModalProps {
  status: UpdateStatus;
  onClose: () => void;
}

export function UpdateModal({ status, onClose }: UpdateModalProps) {
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
    <Button variant="secondary" onClick={onClose}>Close</Button>
  ) : warning ? (
    <>
      <Button variant="secondary" onClick={onClose} disabled={applying}>Cancel</Button>
      <Button variant="primary" onClick={() => handleApply(true)} loading={applying} disabled={applying}>
        Confirm and Continue
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={applying}>Cancel</Button>
      <Button variant="primary" onClick={() => handleApply()} loading={applying} disabled={applying}>
        Update Now
      </Button>
    </>
  );

  return (
    <Modal
      isOpen
      onClose={applying ? () => {} : onClose}
      title="Update Available"
      size="md"
      maxHeight="85vh"
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Version badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <VersionBadge label="Current" version={status.currentVersion} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-lg)' }}>→</span>
          <VersionBadge label="Latest" version={status.latestVersion ?? ''} highlight />
        </div>

        {/* Warning */}
        <div style={{
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-warning-subtle, rgba(255,180,0,0.12))',
          border: '1px solid var(--color-warning, #f0a500)',
          color: 'var(--color-warning, #f0a500)',
          fontSize: 'var(--text-sm)',
        }}>
          ⚠️ This will restart the server and terminate all active sessions.
        </div>

        {/* Deps info */}
        {!applied && (
          <div style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-sm)',
          }}>
            📦 Dependencies will be installed automatically via <code style={{ fontFamily: 'monospace' }}>npm install</code> before the server restarts.
          </div>
        )}

        {/* Success state */}
        {applied && (
          <div style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-success-subtle, rgba(0,200,100,0.12))',
            border: '1px solid var(--color-success)',
            color: 'var(--color-success)',
            fontSize: 'var(--text-sm)',
          }}>
            <strong>Update applied!</strong> Installing dependencies and restarting — the page will reconnect automatically.
          </div>
        )}

        {/* Warning state (local changes) */}
        {warning && (
          <div style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-warning-subtle, rgba(255,180,0,0.12))',
            border: '1px solid var(--color-warning, #f0a500)',
            color: 'var(--color-warning, #f0a500)',
            fontSize: 'var(--text-sm)',
          }}>
            ⚠️ {warning}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255,80,80,0.1)',
            border: '1px solid var(--color-error)',
            color: 'var(--color-error)',
            fontSize: 'var(--text-sm)',
          }}>
            {error}
          </div>
        )}

        {/* Changelog */}
        {status.changelog && !applied && (
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
              What's new
            </div>
            <div style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
              maxHeight: '240px',
              overflowY: 'auto',
              padding: 'var(--space-3)',
              background: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
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
            style={{ fontSize: 'var(--text-sm)', color: 'var(--color-accent)' }}
          >
            View release on GitHub ↗
          </a>
        )}
      </div>
    </Modal>
  );
}

function VersionBadge({ label, version, highlight }: { label: string; version: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
      <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{
        fontSize: 'var(--text-md)',
        fontWeight: 600,
        fontFamily: 'monospace',
        padding: '4px 10px',
        borderRadius: 'var(--radius-pill)',
        background: highlight ? 'var(--color-success-subtle, rgba(0,200,100,0.12))' : 'var(--color-bg-surface)',
        color: highlight ? 'var(--color-success)' : 'var(--color-text-primary)',
        border: `1px solid ${highlight ? 'var(--color-success)' : 'var(--color-border-subtle)'}`,
      }}>
        v{version}
      </span>
    </div>
  );
}
