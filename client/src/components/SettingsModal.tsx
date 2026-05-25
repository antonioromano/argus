import { useState, useEffect } from 'react';
import type { AgentDefinition, AgentFlag, AgentStatus, AppConfig } from '@argus/shared';
import { X } from 'lucide-react';
import { api } from '../services/api.js';
import { Modal } from './primitives/index.js';
import { Button } from './primitives/index.js';
import { Skeleton } from './primitives/index.js';
import { useTheme } from '../context/ThemeContext.js';
import type { ThemeMode } from '../context/ThemeContext.js';

interface SettingsModalProps {
  config: AppConfig;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<AppConfig | void>;
  theme: 'dark' | 'light';
  version?: string;
}

function agentAbbrev(agent: AgentDefinition): string {
  const abbrevs: Record<string, string> = { claude: 'CLd', gemini: 'Gem', codex: 'Cdx' };
  return abbrevs[agent.id] || agent.name.slice(0, 3);
}

export function SettingsModal({ config, onClose, onSave, version }: SettingsModalProps) {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [defaultAgent, setDefaultAgent] = useState(config.defaultAgent);
  const [customAgents, setCustomAgents] = useState<AgentDefinition[]>(config.customAgents);
  const [agentFlags, setAgentFlags] = useState<Record<string, AgentFlag[]>>(config.agentFlags || {});
  const [newFlagValues, setNewFlagValues] = useState<Record<string, string>>({});
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [detecting, setDetecting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const browserSupportsNotifications = 'Notification' in window;
  const permissionAlreadyGranted = browserSupportsNotifications && Notification.permission === 'granted';
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    (config.notificationsEnabled ?? false) && permissionAlreadyGranted,
  );
  const [permissionDenied, setPermissionDenied] = useState(
    browserSupportsNotifications && Notification.permission === 'denied',
  );
  const [needsPermission, setNeedsPermission] = useState(
    (config.notificationsEnabled ?? false) && browserSupportsNotifications && !permissionAlreadyGranted && Notification.permission !== 'denied',
  );

  useEffect(() => {
    api.detectAgents()
      .then((res) => setAgentStatuses(res.agents))
      .catch(console.error)
      .finally(() => setDetecting(false));
  }, []);

  const handleAddCustomAgent = () => {
    const id = crypto.randomUUID();
    setCustomAgents((prev) => [...prev, { id, name: '', command: '', builtin: false }]);
  };

  const handleUpdateCustomAgent = (id: string, field: 'name' | 'command', value: string) => {
    setCustomAgents((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  };

  const handleRemoveCustomAgent = (id: string) => {
    setCustomAgents((prev) => prev.filter((a) => a.id !== id));
    if (defaultAgent === id) setDefaultAgent('claude');
    // Remove flags for deleted agent
    setAgentFlags((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleAddFlag = (agentId: string) => {
    const value = (newFlagValues[agentId] || '').trim();
    if (!value) return;
    const flag: AgentFlag = { id: crypto.randomUUID(), value, enabled: false };
    setAgentFlags((prev) => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), flag],
    }));
    setNewFlagValues((prev) => ({ ...prev, [agentId]: '' }));
  };

  const handleRemoveFlag = (agentId: string, flagId: string) => {
    setAgentFlags((prev) => ({
      ...prev,
      [agentId]: (prev[agentId] || []).filter((f) => f.id !== flagId),
    }));
  };

  const requestNotificationPermission = async () => {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      setNotificationsEnabled(true);
      setPermissionDenied(false);
      setNeedsPermission(false);
    } else {
      setNotificationsEnabled(false);
      setPermissionDenied(result === 'denied');
      setNeedsPermission(false);
    }
  };

  const handleToggleNotifications = async () => {
    if (!notificationsEnabled) {
      await requestNotificationPermission();
    } else {
      setNotificationsEnabled(false);
      setPermissionDenied(false);
      setNeedsPermission(false);
    }
  };

  const handleSave = async () => {
    const invalid = customAgents.find((a) => !a.name.trim() || !a.command.trim());
    if (invalid) {
      setError('All custom agents must have a name and command.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ defaultAgent, customAgents, agentFlags, notificationsEnabled });
      onClose();
    } catch {
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const allAgents: AgentDefinition[] = [
    ...agentStatuses.map((s) => s.agent),
    ...customAgents,
  ];

  // Agents to show in the flags section: builtins from detection + custom agents
  const flagAgents: AgentDefinition[] = allAgents;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Settings"
      size="md"
      maxHeight="85vh"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>Save</Button>
        </>
      }
    >
      {/* Appearance */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <label style={sectionLabel}>Appearance</label>
        <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border-subtle)', width: 'fit-content' }}>
          {(['system', 'dark', 'light'] as ThemeMode[]).map((option, i) => {
            const isActive = themeMode === option;
            const labels: Record<ThemeMode, string> = { system: 'System', dark: 'Dark', light: 'Light' };
            return (
              <button
                key={option}
                onClick={() => setThemeMode(option)}
                style={{
                  padding: '5px 16px',
                  fontSize: 'var(--text-sm)',
                  fontWeight: isActive ? 600 : 400,
                  border: 'none',
                  borderLeft: i > 0 ? '1px solid var(--color-border-subtle)' : 'none',
                  background: isActive ? 'var(--color-accent)' : 'transparent',
                  color: isActive ? (themeMode === 'dark' || (themeMode === 'system') ? '#fff' : '#fff') : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  outline: 'none',
                  letterSpacing: '0.01em',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'var(--color-accent-subtle)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                {labels[option]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Default Agent */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <label htmlFor="settings-default-agent" style={sectionLabel}>Default Agent</label>
        <select
          id="settings-default-agent"
          value={defaultAgent}
          onChange={(e) => setDefaultAgent(e.target.value)}
          style={selectStyle}
        >
          {allAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}{!agent.builtin ? ' (custom)' : ''}
            </option>
          ))}
        </select>
      </section>

      {/* Agent Status */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <label style={sectionLabel}>Agent Status</label>
        {detecting ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Skeleton height="56px" borderRadius="var(--radius-lg)" />
            <Skeleton height="56px" borderRadius="var(--radius-lg)" />
            <Skeleton height="56px" borderRadius="var(--radius-lg)" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {agentStatuses.map(({ agent, installed, resolvedPath }) => (
              <div
                key={agent.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border-base)',
                  background: 'var(--color-bg-surface)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: installed ? 0 : '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: installed ? 'var(--color-success)' : 'var(--color-error)',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {agent.name}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {agent.command}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', color: installed ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 500 }}>
                    {installed ? (resolvedPath || 'installed') : 'not installed'}
                  </span>
                </div>
                {!installed && agent.installCommand && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: '8px' }}>
                    <code
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-bg-code)',
                        color: 'var(--color-accent)',
                        fontSize: 'var(--text-sm)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {agent.installCommand}
                    </code>
                    <button
                      onClick={() => handleCopy(agent.installCommand!)}
                      title="Copy install command"
                      style={copyBtnStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Custom Agents */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <label style={sectionLabel}>Custom Agents</label>
        {customAgents.length === 0 && (
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            No custom agents configured.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {customAgents.map((agent) => (
            <div key={agent.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="text"
                aria-label="Agent name"
                placeholder="Name (e.g. Aider)"
                value={agent.name}
                onChange={(e) => handleUpdateCustomAgent(agent.id, 'name', e.target.value)}
                style={{ ...inputStyle, flex: '0 0 40%' }}
              />
              <input
                type="text"
                aria-label="Agent command"
                placeholder="Command (e.g. aider)"
                value={agent.command}
                onChange={(e) => handleUpdateCustomAgent(agent.id, 'command', e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={() => handleRemoveCustomAgent(agent.id)}
                title="Remove agent"
                style={removeButtonStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-error)';
                  e.currentTarget.style.background = 'var(--color-error-subtle)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                  e.currentTarget.style.background = 'none';
                }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={handleAddCustomAgent}
          style={addButtonStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          + Add Custom Agent
        </button>
      </section>

      {/* Agent Flags */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <label style={sectionLabel}>Agent Flags</label>
        {flagAgents.length === 0 && detecting && (
          <Skeleton height="40px" borderRadius="var(--radius-md)" />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {flagAgents.map((agent) => {
            const flags = agentFlags[agent.id] || [];
            return (
              <div key={agent.id}>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  marginBottom: 'var(--space-2)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {agent.name}
                </div>
                {flags.length === 0 && (
                  <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                    No flags configured.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
                  {flags.map((flag) => (
                    <div key={flag.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <code style={{
                        flex: 1,
                        fontSize: 'var(--text-sm)',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-primary)',
                        padding: '3px 8px',
                        background: 'var(--color-bg-surface)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-subtle)',
                      }}>
                        {flag.value}
                      </code>
                      <button
                        onClick={() => handleRemoveFlag(agent.id, flag.id)}
                        title="Remove flag"
                        style={removeButtonStyle}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--color-error)';
                          e.currentTarget.style.background = 'var(--color-error-subtle)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--color-text-muted)';
                          e.currentTarget.style.background = 'none';
                        }}
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    type="text"
                    aria-label={`Add flag for ${agent.name}`}
                    value={newFlagValues[agent.id] || ''}
                    onChange={(e) => setNewFlagValues((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                    placeholder="--flag-name value"
                    style={{ ...inputStyle, flex: 1, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFlag(agent.id); } }}
                  />
                  <button
                    onClick={() => handleAddFlag(agent.id)}
                    disabled={!(newFlagValues[agent.id] || '').trim()}
                    style={{
                      ...addButtonStyle,
                      marginTop: 0,
                      padding: '6px 12px',
                      color: (newFlagValues[agent.id] || '').trim() ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      cursor: (newFlagValues[agent.id] || '').trim() ? 'pointer' : 'default',
                    }}
                    onMouseEnter={(e) => { if ((newFlagValues[agent.id] || '').trim()) e.currentTarget.style.background = 'var(--color-accent-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Session Notifications */}
      {'Notification' in window && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <label style={sectionLabel}>Session Notifications</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              role="switch"
              aria-checked={notificationsEnabled}
              onClick={handleToggleNotifications}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: notificationsEnabled ? 'var(--color-accent)' : 'var(--color-border-subtle)',
                position: 'relative',
                cursor: 'pointer',
                transition: 'background var(--transition-fast)',
                flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2,
                left: notificationsEnabled ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left var(--transition-fast)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>
              Notify when a session is waiting for input
            </span>
          </div>
          {needsPermission && (
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning, #f0a500)' }}>
                Browser permission required.
              </span>
              <button
                onClick={requestNotificationPermission}
                style={{
                  fontSize: 'var(--text-sm)',
                  padding: '2px 10px',
                  border: '1px solid var(--color-accent)',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                  transition: 'background var(--transition-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                Grant Permission
              </button>
            </div>
          )}
          {permissionDenied && (
            <div style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-warning, #f0a500)',
            }}>
              Notification permission was denied. Enable it in your browser settings.
            </div>
          )}
        </section>
      )}

      {version && (
        <div style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          textAlign: 'center',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          marginBottom: 'var(--space-4)',
        }}>
          Argus v{version}
        </div>
      )}

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
    </Modal>
  );
}

export { agentAbbrev };

const sectionLabel: React.CSSProperties = {
  display: 'block',
  marginBottom: '8px',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 'var(--text-base)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: '100%',
  cursor: 'pointer',
};

const copyBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-secondary)',
  flexShrink: 0,
  transition: 'background var(--transition-fast)',
};

const removeButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  borderRadius: 'var(--radius-sm)',
  transition: 'color var(--transition-fast), background var(--transition-fast)',
};

const addButtonStyle: React.CSSProperties = {
  marginTop: 'var(--space-2)',
  padding: '6px 12px',
  fontSize: 'var(--text-base)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  color: 'var(--color-accent)',
  cursor: 'pointer',
  transition: 'background var(--transition-fast)',
};
