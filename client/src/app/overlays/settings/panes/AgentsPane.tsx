import { Fragment, useState } from 'react';
import type { AgentDefinition, AgentFlag, AppConfig } from '@argus/shared';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Flag } from 'lucide-react';
import {
  Section,
  Field,
  Chip,
  IconButton,
  Button,
  TextInput,
  AlertSheet,
} from '../../../../components/primitives/index.js';
import { AgentGlyph } from '../../../ui/AgentGlyph.js';
import { BUILTIN_AGENTS } from '../../../../constants/builtinAgents.js';
import type { PaneProps } from '../types.js';

const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;
// Mirrors the server guard (config.ts) — custom agent commands are shell-spawned.
const COMMAND_PATTERN = /^[a-zA-Z0-9_@./\- ]+$/;

interface AgentsPaneProps extends PaneProps {
  onSaveFlag: (agentId: string, flag: AgentFlag) => Promise<void>;
  onDeleteFlag: (agentId: string, flagId: string) => Promise<void>;
}

export function AgentsPane({ config, onSave, onSaveFlag, onDeleteFlag }: AgentsPaneProps) {
  const agents = [...BUILTIN_AGENTS, ...config.customAgents];

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [flagInput, setFlagInput] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);

  const [editingAgent, setEditingAgent] = useState<{ id: string | null; name: string; command: string; installUrl: string } | null>(null);
  const [agentFormError, setAgentFormError] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [removingAgent, setRemovingAgent] = useState<AgentDefinition | null>(null);

  const toggleAgent = (agentId: string) => {
    setExpandedAgent((prev) => (prev === agentId ? null : agentId));
    setFlagInput('');
    setFlagError(null);
  };

  const startAddAgent = () => { setEditingAgent({ id: null, name: '', command: '', installUrl: '' }); setAgentFormError(null); };
  const startEditAgent = (a: AgentDefinition) => {
    setEditingAgent({ id: a.id, name: a.name, command: a.command, installUrl: a.installUrl ?? '' });
    setAgentFormError(null);
  };

  const saveAgent = async () => {
    if (!editingAgent) return;
    const name = editingAgent.name.trim();
    const command = editingAgent.command.trim();
    const installUrl = editingAgent.installUrl.trim();
    if (!name) { setAgentFormError('Name is required.'); return; }
    if (!command) { setAgentFormError('Command is required.'); return; }
    if (!COMMAND_PATTERN.test(command)) {
      setAgentFormError('Command may contain only letters, numbers, and _ @ . / - characters.');
      return;
    }
    setSavingAgent(true);
    setAgentFormError(null);
    try {
      const existing = config.customAgents;
      const next: AgentDefinition[] = editingAgent.id === null
        ? [...existing, { id: crypto.randomUUID(), name, command, builtin: false, ...(installUrl ? { installUrl } : {}) }]
        : existing.map((a) => a.id === editingAgent.id ? { ...a, name, command, installUrl: installUrl || undefined } : a);
      await onSave({ customAgents: next });
      setEditingAgent(null);
    } catch (err) {
      setAgentFormError(err instanceof Error ? err.message : 'Failed to save agent.');
    } finally {
      setSavingAgent(false);
    }
  };

  const confirmRemoveAgent = async () => {
    if (!removingAgent) return;
    const id = removingAgent.id;
    const nextAgents = config.customAgents.filter((a) => a.id !== id);
    const nextFlags = { ...config.agentFlags };
    delete nextFlags[id];
    const patch: Partial<AppConfig> = { customAgents: nextAgents, agentFlags: nextFlags };
    if (config.defaultAgent === id) patch.defaultAgent = 'claude';
    try {
      await onSave(patch);
    } finally {
      setRemovingAgent(null);
    }
  };

  const handleAddFlag = async (agentId: string) => {
    const value = flagInput.trim();
    if (!value) return;
    if (!FLAG_PATTERN.test(value)) {
      setFlagError('Must start with -- or - followed by alphanumeric characters');
      return;
    }
    setFlagError(null);
    await onSaveFlag(agentId, { id: crypto.randomUUID(), value, enabled: true });
    setFlagInput('');
  };

  return (
    <>
      <Section title="Default for new sessions">
        <div className="settings-card-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-2)' }}>
            {agents.map((a) => {
              const sel = config.defaultAgent === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => onSave({ defaultAgent: a.id })}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: 'var(--s-3) var(--s-2)',
                    background: sel ? 'var(--accent-bg)' : 'var(--bg-1)',
                    border: `1px solid ${sel ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                    borderRadius: 'var(--r-2)',
                  }}
                >
                  <AgentGlyph agent={a.id} size={28} />
                  <span style={{ fontSize: 'var(--t-xs)', color: sel ? 'var(--accent)' : 'var(--fg-1)' }}>{a.id}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section
        title="Installed agents"
        action={<Button variant="outline" size="sm" icon={Plus} onClick={startAddAgent}>Add custom</Button>}
      >
        {editingAgent && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 'var(--s-3)',
            padding: 'var(--s-4)',
            background: 'var(--bg-1)',
            borderBottom: '1px solid var(--accent-edge)',
          }}>
            <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-0)' }}>
              {editingAgent.id === null ? 'Add custom agent' : 'Edit agent'}
            </div>
            <Field label="Name" required>
              <TextInput value={editingAgent.name} onChange={(v) => setEditingAgent((s) => s && { ...s, name: v })} placeholder="e.g. Aider" />
            </Field>
            <Field label="Command" required hint="binary + args · letters, numbers, _ @ . / - only">
              <TextInput value={editingAgent.command} onChange={(v) => setEditingAgent((s) => s && { ...s, command: v })} placeholder="e.g. aider" mono />
            </Field>
            <Field label="Install URL" hint="optional">
              <TextInput value={editingAgent.installUrl} onChange={(v) => setEditingAgent((s) => s && { ...s, installUrl: v })} placeholder="https://…" mono />
            </Field>
            {agentFormError && (
              <div style={{ fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>{agentFormError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
              <Button variant="ghost" size="sm" onClick={() => setEditingAgent(null)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={savingAgent} onClick={() => void saveAgent()}>
                {editingAgent.id === null ? 'Add agent' : 'Save'}
              </Button>
            </div>
          </div>
        )}
        {agents.map((a) => {
          const expanded = expandedAgent === a.id;
          const agentFlags = config.agentFlags[a.id] ?? [];
          return (
            <Fragment key={a.id}>
              <div
                onClick={() => toggleAgent(a.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-3)',
                  padding: 'var(--s-3) var(--s-4)',
                  borderBottom: expanded ? 'none' : '1px solid var(--line-1)',
                  cursor: 'pointer',
                  background: expanded ? 'var(--bg-1)' : 'transparent',
                }}
              >
                <AgentGlyph agent={a.id} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>{a.name}</div>
                  <div className="mono" style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
                    $ {a.command} {a.builtin ? '' : '· custom'}
                  </div>
                </div>
                <Chip>{agentFlags.length} flags</Chip>
                {!a.builtin && (
                  <>
                    <IconButton icon={Pencil} label="Edit" size="sm" onClick={(e) => { e.stopPropagation(); startEditAgent(a); }} />
                    <IconButton icon={Trash2} label="Remove" size="sm" onClick={(e) => { e.stopPropagation(); setRemovingAgent(a); }} />
                  </>
                )}
                {expanded
                  ? <ChevronDown size={13} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
                  : <ChevronRight size={13} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
                }
              </div>
              {expanded && (
                <div style={{
                  padding: 'var(--s-3) var(--s-4)',
                  background: 'var(--bg-1)',
                  borderBottom: '1px solid var(--line-1)',
                  borderTop: '1px solid var(--line-1)',
                }}>
                  {agentFlags.length === 0 ? (
                    <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)', marginBottom: 'var(--s-3)' }}>
                      No flags yet
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)', marginBottom: 'var(--s-3)' }}>
                      {agentFlags.map((f) => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                          <span className="mono" style={{ flex: 1, fontSize: 'var(--t-sm)', color: 'var(--fg-1)' }}>
                            {f.value}
                          </span>
                          <IconButton
                            icon={Trash2}
                            label="Delete flag"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onDeleteFlag(a.id, f.id); }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <TextInput
                        value={flagInput}
                        onChange={(v) => { setFlagInput(v); setFlagError(null); }}
                        placeholder="--flag value"
                        mono
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleAddFlag(a.id); }}
                        error={!!flagError}
                      />
                      {flagError && (
                        <div style={{ marginTop: 4, fontSize: 'var(--t-tiny)', color: 'var(--danger)' }}>
                          {flagError}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={Flag}
                      onClick={(e) => { e.stopPropagation(); void handleAddFlag(a.id); }}
                      disabled={!flagInput.trim()}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </Section>

      <AlertSheet
        isOpen={removingAgent !== null}
        title="Remove agent?"
        message={`Remove "${removingAgent?.name ?? ''}"? Its saved flags will be cleared. This does not uninstall the CLI.`}
        confirmLabel="Remove agent"
        confirmDestructive
        onConfirm={() => void confirmRemoveAgent()}
        onCancel={() => setRemovingAgent(null)}
      />
    </>
  );
}
