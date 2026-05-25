import { useState, useEffect } from 'react';
import type { AgentDefinition, AgentFlag } from '@argus/shared';
import { X } from 'lucide-react';
import { FolderTree } from './FolderTree.js';
import { Modal } from './primitives/index.js';
import { Button } from './primitives/index.js';
import { api } from '../services/api.js';

interface CreateSessionModalProps {
  onClose: () => void;
  onCreate: (folderPath: string, name?: string, agentType?: string, flags?: string[]) => Promise<void>;
  theme: 'dark' | 'light';
  initialFolderPath?: string | null;
  defaultAgentType?: string;
  agents?: AgentDefinition[];
  agentFlags?: Record<string, AgentFlag[]>;
  onSaveFlag?: (agentId: string, flag: AgentFlag) => Promise<void>;
}

export function CreateSessionModal({ onClose, onCreate, theme, initialFolderPath, defaultAgentType = 'claude', agents = [], agentFlags = {}, onSaveFlag }: CreateSessionModalProps) {
  const [folderPath, setFolderPath] = useState(initialFolderPath || '');
  const [name, setName] = useState('');
  const [agentType, setAgentType] = useState(defaultAgentType);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
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
    if (!folderPath.trim()) {
      setError('Folder path is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const selectedFlags = currentFlags
        .filter((f) => flagStates[f.id])
        .map((f) => f.value);
      await onCreate(folderPath.trim(), name.trim() || undefined, agentType, selectedFlags.length ? selectedFlags : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handlePickFolder = async () => {
    setPicking(true);
    try {
      const path = await api.pickFolder();
      if (path) setFolderPath(path);
    } catch {
      setError('Failed to open folder picker');
    } finally {
      setPicking(false);
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

  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div onDragOver={preventDrag} onDrop={preventDrag}>
      <Modal
        isOpen
        onClose={onClose}
        title="New Session"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" loading={creating} onClick={() => {
              const form = document.getElementById('create-session-form') as HTMLFormElement;
              form?.requestSubmit();
            }}>
              Create
            </Button>
          </>
        }
      >
        <form id="create-session-form" onSubmit={handleSubmit}>
          {/* Folder */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="session-folder-btn" style={labelStyle}>Project Folder</label>

            {!folderPath ? (
              <>
                <button
                  type="button"
                  id="session-folder-btn"
                  onClick={handlePickFolder}
                  disabled={picking}
                  style={{
                    width: '100%',
                    padding: '8px 14px',
                    fontSize: 'var(--text-base)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-input)',
                    color: 'var(--color-accent)',
                    cursor: picking ? 'wait' : 'pointer',
                    marginBottom: 'var(--space-2)',
                    textAlign: 'left',
                    fontWeight: 500,
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-input)'; }}
                >
                  {picking ? 'Opening...' : 'Choose Folder from System...'}
                </button>
                <FolderTree onSelect={setFolderPath} theme={theme} />
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: '6px 10px',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-accent)',
                  background: 'var(--color-accent-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folderPath}
                </span>
                <button
                  type="button"
                  onClick={() => setFolderPath('')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    flexShrink: 0,
                    transition: 'color var(--transition-fast)',
                  }}
                  aria-label="Change folder"
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-error)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>

          {/* Agent */}
          {agents.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={labelStyle}>Agent</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
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
                        gap: '5px',
                        padding: '5px 12px',
                        border: isSelected
                          ? '1px solid var(--color-accent)'
                          : '1px solid var(--color-border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        background: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                        color: isSelected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-sm)',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: isSelected ? 600 : 400,
                        transition: 'border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = 'var(--color-accent)';
                          e.currentTarget.style.color = 'var(--color-accent)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
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
                  aria-label="Add flag"
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

          {/* Name */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label htmlFor="session-name" style={labelStyle}>Session Name (optional)</label>
            <input
              id="session-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to folder name"
              style={inputStyle}
            />
          </div>

          {error && <ErrorBanner message={error} />}
        </form>
      </Modal>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 'var(--text-md)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-deepest)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'var(--font-sans)',
};

function ErrorBanner({ message }: { message: string }) {
  return (
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
      {message}
    </div>
  );
}
