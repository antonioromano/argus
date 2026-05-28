import { useEffect, useState } from 'react';
import type { AgentDefinition, AgentFlag, AppConfig } from '@argus/shared';
import { Play, Folder, Check } from 'lucide-react';
import { isPrimaryModifier } from '../../utils/platform.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import {
  Sheet,
  Field,
  TextInput,
  Button,
  Kbd,
  Chip,
  IconButton,
  Checkbox,
  ErrorState,
  LoadingState,
  AlertSheet,
} from '../../components/primitives/index.js';
import { api } from '../../services/api.js';

interface CreateSheetProps {
  config: AppConfig | null;
  initialFolderPath?: string | null;
  onClose: () => void;
  onCreate: (folderPath: string, name: string | undefined, agentType: string, flags: string[]) => Promise<void>;
  onSaveFlag?: (agentId: string, flag: AgentFlag) => Promise<void>;
}

const BUILTIN_AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex',  name: 'Codex',  command: 'codex',  builtin: true },
];

export function CreateSheet({
  config,
  initialFolderPath,
  onClose,
  onCreate,
  onSaveFlag,
}: CreateSheetProps) {
  const [folderPath, setFolderPath] = useState(initialFolderPath ?? '');
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState<string>(config?.defaultAgent ?? 'claude');
  const [flagStates, setFlagStates] = useState<Record<string, boolean>>({});
  const [newFlag, setNewFlag] = useState('');
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDirty = folderPath.trim() !== (initialFolderPath ?? '') || name.trim() !== '' || newFlag.trim() !== '';
  const handleClose = () => {
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  const agents = config ? [...BUILTIN_AGENTS, ...config.customAgents] : BUILTIN_AGENTS;
  const agentFlags = config?.agentFlags ?? {};
  const currentFlags = agentFlags[agentId] ?? [];

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const f of currentFlags) initial[f.id] = f.enabled;
    setFlagStates(initial);
  }, [agentId, currentFlags.length]);

  // ⌘O folder picker, ⌘↵ submit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPrimaryModifier(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        void handlePickFolder();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handlePickFolder = async () => {
    setPicking(true);
    try {
      const p = await api.pickFolder();
      if (p) setFolderPath(p);
    } catch {
      setError('Folder picker unavailable.');
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!folderPath.trim()) {
      setError('Folder is required.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const selected = currentFlags.filter((f) => flagStates[f.id]).map((f) => f.value);
      await onCreate(folderPath.trim(), name.trim() || undefined, agentId, selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn');
    } finally {
      setCreating(false);
    }
  };

  const handleAddFlag = async () => {
    const v = newFlag.trim();
    if (!v || !onSaveFlag) return;
    const flag: AgentFlag = { id: crypto.randomUUID(), value: v, enabled: false };
    try {
      await onSaveFlag(agentId, flag);
      setFlagStates((prev) => ({ ...prev, [flag.id]: true }));
      setNewFlag('');
    } catch {
      setError('Could not save flag');
    }
  };

  if (!config) {
    return (
      <Sheet title="New shell" eyebrow="ARGUS · CREATE" onClose={onClose} width={560}>
        <LoadingState label="Loading config" />
      </Sheet>
    );
  }

  return (
    <>
    <Sheet
      title="New shell"
      eyebrow="ARGUS · CREATE"
      subtitle="Spin up an agent. Pick a folder, configure flags, hit Spawn."
      width={560}
      onClose={handleClose}
      dirty={isDirty}
      onConfirmClose={() => setConfirmDiscard(true)}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel <span style={{ marginLeft: 6 }}><Kbd>esc</Kbd></span>
          </Button>
          <Button
            variant="primary"
            icon={Play}
            onClick={() => handleSubmit()}
            disabled={creating || !folderPath.trim()}
            loading={creating}
          >
            Spawn shell <span style={{ marginLeft: 6 }}><Kbd>⌘↵</Kbd></span>
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}
      >
        <Field label="Working folder" required hint="⌘O to browse">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
              padding: '6px var(--s-3)',
              height: 36,
              background: 'var(--bg-1)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-2)',
            }}
          >
            <Folder size={14} strokeWidth={1.6} color="var(--accent)" />
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="~/work/argus"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{
                flex: 1,
                background: 'transparent',
                border: 0,
                outline: 'none',
                color: 'var(--fg-0)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-sm)',
              }}
            />
            <Chip onClick={handlePickFolder}>{picking ? 'opening…' : 'browse'}</Chip>
            <IconButton icon={Folder} label="Pick folder" size="sm" onClick={handlePickFolder} />
          </div>
        </Field>

        <Field label="Shell name" hint="optional · auto from folder otherwise">
          <TextInput
            value={name}
            onChange={setName}
            placeholder="e.g. refactor-event-bus"
            mono
          />
        </Field>

        <Field label="Agent" required>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-2)' }}>
            {agents.map((a) => {
              const isSel = agentId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAgentId(a.id)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--s-2)',
                    padding: 'var(--s-2) var(--s-3)',
                    background: isSel ? 'var(--accent-bg)' : 'var(--bg-1)',
                    border: `1px solid ${isSel ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                    borderRadius: 'var(--r-2)',
                  }}
                >
                  <AgentGlyph agent={a.id} size={22} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>{a.name}</div>
                    <div className="eyebrow" style={{ marginTop: 2 }}>{a.builtin ? a.id : 'custom'}</div>
                  </div>
                  {isSel && <Check size={14} strokeWidth={2.5} color="var(--accent)" />}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Flags" hint={currentFlags.length === 0 ? 'no flags configured' : undefined}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {currentFlags.map((flag) => (
              <label
                key={flag.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  cursor: 'pointer',
                  padding: '3px 0',
                }}
              >
                <Checkbox
                  checked={!!flagStates[flag.id]}
                  onChange={(v) => setFlagStates((p) => ({ ...p, [flag.id]: v }))}
                  size={14}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>
                  {flag.value}
                </span>
              </label>
            ))}
            {onSaveFlag && (
              <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    value={newFlag}
                    onChange={setNewFlag}
                    placeholder="--flag-name value"
                    mono
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFlag(); } }}
                  />
                </div>
                <Button variant="outline" size="md" disabled={!newFlag.trim()} onClick={handleAddFlag}>
                  + Add
                </Button>
              </div>
            )}
          </div>
        </Field>

        {error && <ErrorState title="Cannot spawn" detail={error} />}
      </form>
    </Sheet>
    <AlertSheet
      isOpen={confirmDiscard}
      title="Discard new shell?"
      message="You'll lose the folder, name, and flag changes."
      confirmLabel="Discard"
      confirmDestructive
      onConfirm={() => { setConfirmDiscard(false); onClose(); }}
      onCancel={() => setConfirmDiscard(false)}
    />
    </>
  );
}
