import { useState, useEffect } from 'react';
import type { AgentDefinition, AgentFlag } from '@argus/shared';
import { MacSheet } from './MacSheet.js';
import { MacInput } from './primitives/index.js';

interface MacCloneSessionSheetProps {
  isOpen: boolean;
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

export function MacCloneSessionSheet({
  isOpen,
  folderPath,
  currentAgentType,
  agents,
  defaultAgentType = 'claude',
  onClone,
  onClose,
  agentFlags = {},
  onSaveFlag,
}: MacCloneSessionSheetProps) {
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

  // Allow the footer button to trigger form submission imperatively
  const triggerSubmit = () => {
    const form = document.getElementById('mac-clone-session-form') as HTMLFormElement;
    form?.requestSubmit();
  };

  return (
    <MacSheet
      isOpen={isOpen}
      title="Clone Session"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button
            onClick={triggerSubmit}
            disabled={cloning}
            style={{
              ...primaryBtnStyle,
              opacity: cloning ? 0.45 : 1,
              cursor: cloning ? 'default' : 'pointer',
            }}
          >
            {cloning ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      }
    >
      <form id="mac-clone-session-form" onSubmit={handleSubmit}>
        {/* Folder display — read-only pill */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Folder</label>
          <div
            style={{
              padding: '4px 8px',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-accent)',
              background: 'var(--color-accent-subtle)',
              borderRadius: 6,
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
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Agent</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {agents.map((agent) => {
                const isSelected = agentType === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setAgentType(agent.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 12px',
                      borderRadius: 6,
                      border: isSelected
                        ? '1.5px solid var(--color-accent)'
                        : '1px solid var(--color-border-base)',
                      background: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                      color: isSelected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                        e.currentTarget.style.color = 'var(--color-accent)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = 'var(--color-border-base)';
                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                      }
                    }}
                  >
                    {agent.name}
                    {!agent.builtin && (
                      <span style={{ fontSize: 'var(--text-xs)', opacity: 0.7 }}>custom</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Flags */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Flags</label>
          {currentFlags.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              {currentFlags.map((flag) => (
                <label
                  key={flag.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <MacInput
                  value={newFlagValue}
                  onChange={setNewFlagValue}
                  placeholder="--flag-name value"
                  mono
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFlag(); } }}
                />
              </div>
              <button
                type="button"
                onClick={handleAddFlag}
                disabled={savingFlag || !newFlagValue.trim()}
                style={{
                  padding: '6px 12px',
                  fontSize: 'var(--text-sm)',
                  border: '1px solid var(--color-border-base)',
                  borderRadius: 6,
                  background: 'transparent',
                  color: newFlagValue.trim() ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  cursor: newFlagValue.trim() ? 'pointer' : 'default',
                  flexShrink: 0,
                  fontFamily: 'var(--font-sans)',
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
              marginBottom: 16,
              padding: '8px 10px',
              background: 'var(--color-error-bg)',
              color: 'var(--color-error)',
              borderRadius: 6,
              fontSize: 'var(--text-sm)',
            }}
          >
            {error}
          </div>
        )}
      </form>
    </MacSheet>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
  display: 'block',
  marginBottom: 4,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: 8,
  border: '1px solid var(--color-border-subtle)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
