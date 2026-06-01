import { useEffect, useRef, useState } from 'react';
import type { AgentDefinition, AgentFlag, AppConfig } from '@argus/shared';
import { Copy, Check, GitBranch } from 'lucide-react';
import { api } from '../../services/api.js';
import { Toggle } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import {
  Sheet,
  Field,
  TextInput,
  Button,
  Kbd,
  Checkbox,
  ErrorState,
  AlertSheet,
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
  const [initializingGit, setInitializingGit] = useState(false);
  const [useWorktree, setUseWorktree] = useState(false);
  const [branchName, setBranchName] = useState(() => {
    const slug = folderPath.split('/').pop()?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ?? 'session';
    return `argus/${slug}`;
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const initialAgentId = currentAgentType ?? config?.defaultAgent ?? 'claude';
  const [initialBranch] = useState(branchName);
  const submitRef = useRef<() => void>(() => {});

  const agents = config ? [...BUILTIN, ...config.customAgents] : BUILTIN;
  const agentFlags = config?.agentFlags ?? {};
  const currentFlags = agentFlags[agentId] ?? [];

  // Seed flag checkboxes from the selected agent's defaults whenever the agent
  // changes (adjust-during-render — no effect, runs before paint).
  const [seededAgent, setSeededAgent] = useState<string | null>(null);
  if (seededAgent !== agentId) {
    setSeededAgent(agentId);
    const initial: Record<string, boolean> = {};
    for (const f of currentFlags) initial[f.id] = f.enabled;
    setFlagStates(initial);
  }

  const isDirty =
    agentId !== initialAgentId ||
    newFlag.trim() !== '' ||
    useWorktree ||
    branchName !== initialBranch;

  const handleClose = () => {
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

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

  const handleGitInit = async () => {
    setInitializingGit(true);
    try {
      await api.gitInit(folderPath);
      const r = await api.checkWorktree({ repoPath: folderPath });
      setIsGitRepo(r.isGitRepo);
    } catch { /* user can retry */ } finally {
      setInitializingGit(false);
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

  // ⌘↵ submit — bind once, call latest handler via ref.
  useEffect(() => { submitRef.current = () => void handleSubmit(); });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
    <Sheet
      title="Clone shell"
      eyebrow="ARGUS · CLONE"
      subtitle={`New shell in ${folderPath}`}
      width={520}
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
            icon={Copy}
            onClick={handleSubmit}
            disabled={submitting}
            loading={submitting}
          >
            Clone shell <span style={{ marginLeft: 6 }}><Kbd>⌘↵</Kbd></span>
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
        <Field label="Folder" hint="locked — clones inherit folder">
          <TextInput value={folderPath} mono disabled />
        </Field>

        <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)',
            padding: '10px 12px',
            background: 'var(--bg-1)',
            borderBottom: (useWorktree && isGitRepo) ? '1px solid var(--line-2)' : 'none',
          }}>
            <div>
              <div style={{ fontSize: 'var(--t-sm)', fontWeight: 500, color: isGitRepo === false ? 'var(--fg-3)' : 'var(--fg-0)' }}>
                Agent isolation
              </div>
              <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-2)', marginTop: 2 }}>
                {isGitRepo === false
                  ? 'Requires a git repository'
                  : useWorktree
                    ? 'This session works in its own branch — no conflicts with other agents'
                    : 'Prevent file conflicts when running multiple agents on the same repo'}
              </div>
            </div>
            <Toggle
              checked={useWorktree && isGitRepo === true}
              onChange={(v) => setUseWorktree(v)}
              disabled={isGitRepo !== true}
            />
          </div>
          {useWorktree && isGitRepo === true && (
            <div style={{ padding: '10px 12px', background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Branch name
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                <GitBranch size={13} strokeWidth={1.6} color="var(--accent)" style={{ flexShrink: 0 }} />
                <TextInput value={branchName} onChange={setBranchName} placeholder="argus/my-feature" mono />
              </div>
            </div>
          )}
          {isGitRepo === false && (
            <div style={{
              padding: '7px 12px',
              background: 'var(--warn-bg)',
              borderTop: '1px solid color-mix(in srgb, var(--warn) 25%, transparent)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-3)',
            }}>
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--warn)', flex: 1 }}>
                ⚠ Not a git repository
              </span>
              <button
                type="button"
                onClick={handleGitInit}
                disabled={initializingGit}
                style={{
                  fontSize: 'var(--t-xs)',
                  color: 'var(--warn)',
                  background: 'transparent',
                  border: '1px solid color-mix(in srgb, var(--warn) 45%, transparent)',
                  borderRadius: 'var(--r-1)',
                  cursor: initializingGit ? 'default' : 'pointer',
                  padding: '2px 8px',
                  fontFamily: 'var(--font-sans)',
                  opacity: initializingGit ? 0.6 : 1,
                  flexShrink: 0,
                }}
              >
                {initializingGit ? 'Initializing…' : 'Initialize'}
              </button>
            </div>
          )}
        </div>

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
    <AlertSheet
      isOpen={confirmDiscard}
      title="Discard changes?"
      message="You have unsaved selections. Close this sheet and discard them?"
      confirmLabel="Discard"
      confirmDestructive
      onConfirm={() => { setConfirmDiscard(false); onClose(); }}
      onCancel={() => setConfirmDiscard(false)}
    />
    </>
  );
}
