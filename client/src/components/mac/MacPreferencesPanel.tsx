import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { AgentDefinition, AgentFlag, AgentStatus, AppConfig } from '@argus/shared';
import { useTheme } from '../../context/ThemeContext.js';
import type { ThemeMode } from '../../context/ThemeContext.js';
import { api } from '../../services/api.js';
import { Skeleton } from '../primitives/index.js';
import { MacInput, MacSelect, MacSegmentedControl } from './primitives/index.js';

interface MacPreferencesPanelProps {
  isOpen: boolean;
  config: AppConfig;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<AppConfig | void>;
  version?: string;
  onOpenRemote?: () => void;
}

type PrefTab = 'general' | 'agents' | 'remote';

export function MacPreferencesPanel({
  isOpen,
  config,
  onClose,
  onSave,
  version,
  onOpenRemote,
}: MacPreferencesPanelProps) {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [activeTab, setActiveTab] = useState<PrefTab>('general');

  // --- Ported state from SettingsModal ---
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
    (config.notificationsEnabled ?? false) &&
      browserSupportsNotifications &&
      !permissionAlreadyGranted &&
      Notification.permission !== 'denied',
  );

  // Detect installed agents on mount
  useEffect(() => {
    api.detectAgents()
      .then((res) => setAgentStatuses(res.agents))
      .catch(console.error)
      .finally(() => setDetecting(false));
  }, []);

  // --- Handlers ported from SettingsModal ---

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

  const flagAgents: AgentDefinition[] = allAgents;

  const tabs: { id: PrefTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'agents',  label: 'Agents'  },
    { id: 'remote',  label: 'Remote'  },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Preferences"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 180,
        display: isOpen ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.25)',
      }}
      // Close on backdrop click
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        style={{
          width: 560,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: '80vh',
          background: 'var(--color-bg-preferences, var(--color-bg-modal))',
          borderRadius: 12,
          boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Panel header with segmented tabs */}
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border-base)',
            padding: '0 52px',
            position: 'relative',
          }}
        >
          {/* Segmented control */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              background: 'var(--color-bg-surface)',
              borderRadius: 8,
              padding: 2,
            }}
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '5px 16px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: isActive ? 600 : 400,
                    borderRadius: 6,
                    background: isActive ? 'var(--color-bg-elevated)' : 'transparent',
                    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'background 0.12s ease',
                    outline: 'none',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Close button */}
          <CloseButton onClick={onClose} />
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {activeTab === 'general' && (
            <GeneralTab
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              defaultAgent={defaultAgent}
              setDefaultAgent={setDefaultAgent}
              allAgents={allAgents}
              agentStatuses={agentStatuses}
              detecting={detecting}
              notificationsEnabled={notificationsEnabled}
              handleToggleNotifications={handleToggleNotifications}
              needsPermission={needsPermission}
              permissionDenied={permissionDenied}
              requestNotificationPermission={requestNotificationPermission}
              handleCopy={handleCopy}
            />
          )}

          {activeTab === 'agents' && (
            <AgentsTab
              customAgents={customAgents}
              handleAddCustomAgent={handleAddCustomAgent}
              handleUpdateCustomAgent={handleUpdateCustomAgent}
              handleRemoveCustomAgent={handleRemoveCustomAgent}
              flagAgents={flagAgents}
              agentFlags={agentFlags}
              newFlagValues={newFlagValues}
              setNewFlagValues={setNewFlagValues}
              handleAddFlag={handleAddFlag}
              handleRemoveFlag={handleRemoveFlag}
              detecting={detecting}
            />
          )}

          {activeTab === 'remote' && (
            <RemoteTab
              onClose={onClose}
              onOpenRemote={onOpenRemote}
            />
          )}

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 'var(--space-4)',
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
        </div>

        {/* Footer */}
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            borderTop: '1px solid var(--color-border-base)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {version ? `Argus v${version}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={secondaryBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-surface)'; }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                ...primaryBtnStyle,
                opacity: saving ? 0.7 : 1,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

function CloseButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        right: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 28,
        height: 28,
        border: 'none',
        background: hovered ? 'var(--color-bg-elevated)' : 'transparent',
        borderRadius: '50%',
        cursor: 'pointer',
        color: 'var(--color-text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background var(--transition-fast)',
      }}
    >
      <X size={16} strokeWidth={2} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------------

interface GeneralTabProps {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  defaultAgent: string;
  setDefaultAgent: (id: string) => void;
  allAgents: AgentDefinition[];
  agentStatuses: AgentStatus[];
  detecting: boolean;
  notificationsEnabled: boolean;
  handleToggleNotifications: () => Promise<void>;
  needsPermission: boolean;
  permissionDenied: boolean;
  requestNotificationPermission: () => Promise<void>;
  handleCopy: (text: string) => void;
}

function GeneralTab({
  themeMode,
  setThemeMode,
  defaultAgent,
  setDefaultAgent,
  allAgents,
  agentStatuses,
  detecting,
  notificationsEnabled,
  handleToggleNotifications,
  needsPermission,
  permissionDenied,
  requestNotificationPermission,
  handleCopy,
}: GeneralTabProps) {
  return (
    <>
      {/* Appearance row */}
      <PrefRow
        label="Appearance"
      >
        <MacSegmentedControl
          segments={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={themeMode}
          onChange={(v) => setThemeMode(v as ThemeMode)}
        />
      </PrefRow>

      {/* Default Agent row */}
      <PrefRow label="Default Agent">
        <MacSelect
          options={allAgents.map((agent) => ({
            value: agent.id,
            label: agent.name + (!agent.builtin ? ' (custom)' : ''),
          }))}
          value={defaultAgent}
          onChange={setDefaultAgent}
        />
      </PrefRow>

      {/* Notifications row */}
      {'Notification' in window && (
        <PrefRow
          label="Notifications"
          subLabel="Notify when a session needs input"
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <ToggleSwitch
              checked={notificationsEnabled}
              onChange={handleToggleNotifications}
            />
            {needsPermission && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--color-warning, #f0a500)' }}>
                  Permission required.
                </span>
                <button
                  onClick={requestNotificationPermission}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    border: '1px solid var(--color-accent)',
                    borderRadius: 'var(--radius-md)',
                    background: 'transparent',
                    color: 'var(--color-accent)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Grant
                </button>
              </div>
            )}
            {permissionDenied && (
              <span style={{ fontSize: 11, color: 'var(--color-warning, #f0a500)' }}>
                Denied — enable in system settings.
              </span>
            )}
          </div>
        </PrefRow>
      )}

      {/* Agent Status section */}
      <div style={{ marginTop: 20 }}>
        <SectionLabel>Agent Status</SectionLabel>
        {detecting ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton height="56px" borderRadius="var(--radius-lg)" />
            <Skeleton height="56px" borderRadius="var(--radius-lg)" />
            <Skeleton height="56px" borderRadius="var(--radius-lg)" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: installed ? 0 : 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: installed ? 'var(--color-success)' : 'var(--color-error)',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {agent.name}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {agent.command}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: installed ? 'var(--color-success)' : 'var(--color-error)',
                      fontWeight: 500,
                    }}
                  >
                    {installed ? (resolvedPath || 'installed') : 'not installed'}
                  </span>
                </div>
                {!installed && agent.installCommand && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 8 }}>
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
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

interface AgentsTabProps {
  customAgents: AgentDefinition[];
  handleAddCustomAgent: () => void;
  handleUpdateCustomAgent: (id: string, field: 'name' | 'command', value: string) => void;
  handleRemoveCustomAgent: (id: string) => void;
  flagAgents: AgentDefinition[];
  agentFlags: Record<string, AgentFlag[]>;
  newFlagValues: Record<string, string>;
  setNewFlagValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleAddFlag: (agentId: string) => void;
  handleRemoveFlag: (agentId: string, flagId: string) => void;
  detecting: boolean;
}

function AgentsTab({
  customAgents,
  handleAddCustomAgent,
  handleUpdateCustomAgent,
  handleRemoveCustomAgent,
  flagAgents,
  agentFlags,
  newFlagValues,
  setNewFlagValues,
  handleAddFlag,
  handleRemoveFlag,
  detecting,
}: AgentsTabProps) {
  return (
    <>
      {/* Custom Agents */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <SectionLabel>Custom Agents</SectionLabel>
        {customAgents.length === 0 && (
          <div
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-2)',
            }}
          >
            No custom agents configured.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {customAgents.map((agent) => (
            <div key={agent.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <div style={{ flex: '0 0 40%' }}>
                <MacInput
                  value={agent.name}
                  onChange={(v) => handleUpdateCustomAgent(agent.id, 'name', v)}
                  placeholder="Name (e.g. Aider)"
                />
              </div>
              <div style={{ flex: 1 }}>
                <MacInput
                  value={agent.command}
                  onChange={(v) => handleUpdateCustomAgent(agent.id, 'command', v)}
                  placeholder="Command (e.g. aider)"
                  mono
                />
              </div>
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
        <SectionLabel>Agent Flags</SectionLabel>
        {flagAgents.length === 0 && detecting && (
          <Skeleton height="40px" borderRadius="var(--radius-md)" />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {flagAgents.map((agent) => {
            const flags = agentFlags[agent.id] || [];
            return (
              <div key={agent.id}>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    marginBottom: 'var(--space-2)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {agent.name}
                </div>
                {flags.length === 0 && (
                  <div
                    style={{
                      fontSize: 'var(--text-base)',
                      color: 'var(--color-text-muted)',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    No flags configured.
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-1)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  {flags.map((flag) => (
                    <div
                      key={flag.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                    >
                      <code
                        style={{
                          flex: 1,
                          fontSize: 'var(--text-sm)',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--color-text-primary)',
                          padding: '3px 8px',
                          background: 'var(--color-bg-surface)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border-subtle)',
                        }}
                      >
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
                  <div style={{ flex: 1 }}>
                    <MacInput
                      value={newFlagValues[agent.id] || ''}
                      onChange={(v) => setNewFlagValues((prev) => ({ ...prev, [agent.id]: v }))}
                      placeholder="--flag-name value"
                      mono
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddFlag(agent.id);
                        }
                      }}
                    />
                  </div>
                  <button
                    onClick={() => handleAddFlag(agent.id)}
                    disabled={!(newFlagValues[agent.id] || '').trim()}
                    style={{
                      ...addButtonStyle,
                      marginTop: 0,
                      padding: '6px 12px',
                      color: (newFlagValues[agent.id] || '').trim()
                        ? 'var(--color-accent)'
                        : 'var(--color-text-muted)',
                      cursor: (newFlagValues[agent.id] || '').trim() ? 'pointer' : 'default',
                    }}
                    onMouseEnter={(e) => {
                      if ((newFlagValues[agent.id] || '').trim())
                        e.currentTarget.style.background = 'var(--color-accent-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Remote tab (lightweight — points user to the remote panel)
// ---------------------------------------------------------------------------

function RemoteTab({
  onClose,
  onOpenRemote,
}: {
  onClose: () => void;
  onOpenRemote?: () => void;
}) {
  return (
    <div
      style={{
        padding: '8px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-base)',
          background: 'var(--color-bg-surface)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 4,
            }}
          >
            Remote Access
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
            }}
          >
            Start an ngrok tunnel to access Argus from anywhere.
          </div>
        </div>
        <button
          onClick={() => {
            onClose();
            onOpenRemote?.();
          }}
          style={{
            flexShrink: 0,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            color: 'var(--color-accent)',
            cursor: 'pointer',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Manage
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function PrefRow({
  label,
  subLabel,
  children,
}: {
  label: string;
  subLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--color-border-ghost)',
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>{label}</div>
        {subLabel && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{subLabel}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        background: checked ? 'var(--color-accent)' : 'var(--color-border-subtle)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background var(--transition-fast)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left var(--transition-fast)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

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

const secondaryBtnStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 'var(--text-base)',
  fontWeight: 500,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'background var(--transition-fast)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 'var(--text-base)',
  fontWeight: 600,
  border: 'none',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-accent)',
  color: '#fff',
  cursor: 'pointer',
};
