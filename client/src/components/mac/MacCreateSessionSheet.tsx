import { useState, useEffect } from 'react';
import type { AgentDefinition, AgentFlag } from '@argus/shared';
import { X } from 'lucide-react';
import { MacSheet } from './MacSheet.js';
import { MacInput, MacSegmentedControl } from './primitives/index.js';
import { api } from '../../services/api.js';

interface MacCreateSessionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (folderPath: string, name?: string, agentType?: string, flags?: string[]) => Promise<void>;
  theme: 'dark' | 'light';
  initialFolderPath?: string | null;
  defaultAgentType?: string;
  agents?: AgentDefinition[];
  agentFlags?: Record<string, AgentFlag[]>;
  onSaveFlag?: (agentId: string, flag: AgentFlag) => Promise<void>;
}

export function MacCreateSessionSheet({
  isOpen,
  onClose,
  onCreate,
  theme: _theme,
  initialFolderPath,
  defaultAgentType = 'claude',
  agents = [],
  agentFlags = {},
  onSaveFlag,
}: MacCreateSessionSheetProps) {
  const [folderPath, setFolderPath] = useState(initialFolderPath || '');
  const [name, setName] = useState('');
  const [agentType, setAgentType] = useState(defaultAgentType);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [flagStates, setFlagStates] = useState<Record<string, boolean>>({});
  const [newFlagValue, setNewFlagValue] = useState('');
  const [savingFlag, setSavingFlag] = useState(false);

  // Sync folder path when parent picks a folder before opening the sheet
  useEffect(() => {
    if (initialFolderPath) setFolderPath(initialFolderPath);
  }, [initialFolderPath]);

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

  // Allow the footer button to trigger form submission imperatively
  const triggerSubmit = () => {
    const form = document.getElementById('mac-create-session-form') as HTMLFormElement;
    form?.requestSubmit();
  };

  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div onDragOver={preventDrag} onDrop={preventDrag}>
      <MacSheet
        isOpen={isOpen}
        title="New Session"
        onClose={onClose}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button
              onClick={triggerSubmit}
              disabled={!folderPath.trim() || creating}
              style={{
                ...primaryBtnStyle,
                opacity: !folderPath.trim() || creating ? 0.45 : 1,
                cursor: !folderPath.trim() || creating ? 'default' : 'pointer',
              }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        }
      >
        <form id="mac-create-session-form" onSubmit={handleSubmit}>
          {/* Folder */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="mac-session-folder-btn" style={labelStyle}>Project Folder</label>

            {!folderPath ? (
              <button
                type="button"
                id="mac-session-folder-btn"
                onClick={handlePickFolder}
                disabled={picking}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 'var(--text-base)',
                  border: '1px solid var(--color-border-base)',
                  borderRadius: 6,
                  background: 'var(--color-bg-input)',
                  color: 'var(--color-accent)',
                  cursor: picking ? 'wait' : 'pointer',
                  textAlign: 'left',
                  fontWeight: 500,
                  fontFamily: 'var(--font-sans)',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-input)'; }}
              >
                {picking ? 'Opening...' : 'Choose Folder from System...'}
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-accent)',
                  background: 'var(--color-accent-subtle)',
                  borderRadius: 6,
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
                  }}
                  aria-label="Change folder"
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-error)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>

          {/* Agent */}
          {agents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>Agent</label>
              <MacSegmentedControl
                segments={agents.map((a) => ({ value: a.id, label: a.builtin ? a.name : `${a.name} (custom)` }))}
                value={agentType}
                onChange={setAgentType}
                wrap
              />
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
              <div style={{ display: 'flex', gap: 8 }}>
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

          {/* Session Name */}
          <div style={{ marginBottom: 20 }}>
            <MacInput
              id="mac-session-name"
              label="Session Name (optional)"
              value={name}
              onChange={setName}
              placeholder="Defaults to folder name"
            />
          </div>

          {error && <ErrorBanner message={error} />}
        </form>
      </MacSheet>
    </div>
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

function ErrorBanner({ message }: { message: string }) {
  return (
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
      {message}
    </div>
  );
}
