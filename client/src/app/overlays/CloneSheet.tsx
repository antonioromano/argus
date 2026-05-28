import { useEffect, useState } from 'react';
import type { AgentDefinition, AgentFlag, AppConfig } from '@argus/shared';
import { Copy, Check, GitBranch } from 'lucide-react';
import { api } from '../../services/api.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import {
  Sheet,
  Field,
  TextInput,
  Button,
  Kbd,
  Checkbox,
  ErrorState,
} from '../../components/primitives/index.js';

const BUILTIN: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
];

interface CloneSheetProps {
  config: AppConfig | null;
  folderPath: string;
  currentAgentType?: string;
  onClose: () => void;
  onClone: (folderPath: string, agentType: string, flags: string[], worktreeBranch?: string) => Promise<void>;
  onSaveFlag?: (agentId: string, flag: AgentFlag) => Promise<void>;
}

export function CloneSheet({
  config,
  folderPath,
  currentAgentType,
  onClose,
  onClone,
  onSaveFlag,
}: CloneSheetProps) {
  const [agentId, setAgentId] = useState<string>(currentAgentType ?? config?.defaultAgent ?? 'claude');
  const [flagStates, setFlagStates] = useState<Record<string, boolean>>({});
  const [newFlag, setNewFlag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Worktree state — folderPath is a static prop, check once on mount
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [useWorktree, setUseWorktree] = useState(true);
  const [branchName, setBranchName] = useState(() => {
    const slug = folderPath.split('/').pop()?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ?? 'session';
    return `argus/${slug}`;
  });

  const agents = config ? [...BUILTIN, ...config.customAgents] : BUILTIN;
  const agentFlags = config?.agentFlags ?? {};
  const currentFlags = agentFlags[agentId] ?? [];

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const f of currentFlags) initial[f.id] = f.enabled;
    setFlagStates(initial);
  }, [agentId, currentFlags.length]);

  useEffect(() => {
    api.checkWorktree({ repoPath: folderPath })
      .then((r) => setIsGitRepo(r.isGitRepo))
      .catch(() => setIsGitRepo(false));
  }, [folderPath]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const flags = currentFlags.filter((f) => flagStates[f.id]).map((f) => f.value);
      const branch = (isGitRepo && useWorktree) ? branchName.trim() : undefined;
      await onClone(folderPath, agentId, flags, branch || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone');
    } finally {
      setSubmitting(false);
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

  return (
    <Sheet
      title="Clone shell"
      eyebrow="ARGUS · CLONE"
      subtitle={`New shell in ${folderPath}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel <span style={{ marginLeft: 6 }}><Kbd>esc</Kbd></span>
          </Button>
          <Button
            variant="primary"
            icon={Copy}
            onClick={handleSubmit}
            disabled={submitting}
            loading={submitting}
          >
            Clone shell
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
        <Field label="Folder" hint="locked — clones inherit folder">
          <TextInput value={folderPath} mono disabled />
        </Field>

        {isGitRepo === true && (
          <Field label="Worktree branch" hint={useWorktree ? 'isolates this session on its own branch' : undefined}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
              {useWorktree && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                  <GitBranch size={14} strokeWidth={1.6} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <TextInput value={branchName} onChange={setBranchName} placeholder="argus/my-feature" mono />
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}>
                <Checkbox checked={!useWorktree} onChange={(v) => setUseWorktree(!v)} size={14} />
                <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-2)' }}>Use main repo (no worktree)</span>
              </label>
            </div>
          </Field>
        )}

        {isGitRepo === false && (
          <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)', padding: '0 2px' }}>
            Worktree isolation requires a git repo. Initialize one to enable this.
          </div>
        )}

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
                  <AgentGlyph agent={a.id} size={20} />
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

        <Field label="Flags">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {currentFlags.map((flag) => (
              <label key={flag.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}>
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
                <Button variant="outline" size="md" disabled={!newFlag.trim()} onClick={handleAddFlag}>+ Add</Button>
              </div>
            )}
          </div>
        </Field>

        {error && <ErrorState title="Cannot clone" detail={error} />}
      </div>
    </Sheet>
  );
}
