import { useState, useEffect } from 'react';
import type { AgentDefinition, AgentFlag } from '@argus/shared';
import { Modal } from './primitives/index.js';
import { Button } from './primitives/index.js';

interface CloneSessionModalProps {
  folderPath: string;
  currentAgentType?: string;
  agents: AgentDefinition[];
  defaultAgentType?: string;
  theme: 'dark' | 'light';
  onClone: (folderPath: string, agentType: string, flags?: string[]) => Promise<void>;
  onClose: () => void;
  agentFlags?: Record<string, AgentFlag[]>;
  onSaveFlag?: (agentId: string, flag: AgentFlag) => Promise<void>;
}

export function CloneSessionModal({
  folderPath,
  currentAgentType,
  agents,
  defaultAgentType = 'claude',
  onClone,
  onClose,
  agentFlags = {},
  onSaveFlag,
}: CloneSessionModalProps) {
  const [agentType, setAgentType] = useState(currentAgentType || defaultAgentType);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState('');
  const [flagStates, setFlagStates] = useState<Record<string, boolean>>({});
  const [newFlagValue, setNewFlagValue] = useState('');
  const [savingFlag, setSavingFlag] = useState(false);

  // Re-initialize flag states from sticky defaults when agent changes
  useEffect(() => {
    const flags = agentFlags[agentType] || [];
    const initial: Record<string, boolean> = {};
    for (const flag of flags) {
      initial[flag.id] = flag.enabled;
    }
    setFlagStates(initial);
  }, [agentType, agentFlags]);

  const currentFlags = agentFlags[agentType] || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloning(true);
    setError('');
    try {
      const selectedFlags = currentFlags
        .filter((f) => flagStates[f.id])
        .map((f) => f.value);
      await onClone(folderPath, agentType, selectedFlags.length ? selectedFlags : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setCloning(false);
    }
  };

  const handleAddFlag = async () => {
    const trimmed = newFlagValue.trim();
    if (!trimmed || !onSaveFlag) return;
    setSavingFlag(true);
    try {
      const flag: AgentFlag = { id: crypto.randomUUID(), value: trimmed, enabled: false };
      await onSaveFlag(agentType, flag);
      setFlagStates((prev) => ({ ...prev, [flag.id]: true }));
      setNewFlagValue('');
    } catch {
      setError('Failed to save flag');
    } finally {
      setSavingFlag(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Clone Session"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={cloning} onClick={() => {
            const form = document.getElementById('clone-session-form') as HTMLFormElement;
            form?.requestSubmit();
          }}>
            Clone
          </Button>
        </>
      }
    >
      <form id="clone-session-form" onSubmit={handleSubmit}>
        {/* Folder display */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={labelStyle}>Folder</label>
          <div
            style={{
              padding: '6px 10px',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-accent)',
              background: 'var(--color-accent-bg)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {folderPath}
          </div>
        </div>

        {/* Agent */}
        {agents.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="clone-agent-select" style={labelStyle}>Agent</label>
            <select
              id="clone-agent-select"
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
              style={selectStyle}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}{!agent.builtin ? ' (custom)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Flags */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={labelStyle}>Flags</label>
          {currentFlags.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
              {currentFlags.map((flag) => (
                <label
                  key={flag.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    cursor: 'pointer',
                    padding: '3px 0',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={flagStates[flag.id] ?? false}
                    onChange={(e) => setFlagStates((prev) => ({ ...prev, [flag.id]: e.target.checked }))}
                    style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                  />
                  <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                    {flag.value}
                  </span>
                </label>
              ))}
            </div>
          )}
          {onSaveFlag && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                type="text"
                value={newFlagValue}
                onChange={(e) => setNewFlagValue(e.target.value)}
                placeholder="--flag-name value"
                style={{ ...inputStyle, flex: 1, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFlag(); } }}
              />
              <button
                type="button"
                onClick={handleAddFlag}
                disabled={savingFlag || !newFlagValue.trim()}
                style={{
                  padding: '6px 12px',
                  fontSize: 'var(--text-sm)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: newFlagValue.trim() ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  cursor: newFlagValue.trim() ? 'pointer' : 'default',
                  flexShrink: 0,
                  transition: 'background var(--transition-fast)',
                }}
                onMouseEnter={(e) => { if (newFlagValue.trim()) e.currentTarget.style.background = 'var(--color-accent-subtle)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {savingFlag ? 'Saving...' : '+ Add'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 'var(--space-4)',
              padding: '8px 12px',
              background: 'var(--color-error-bg)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-base)',
            }}
          >
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: 'var(--text-base)',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 'var(--text-md)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};
