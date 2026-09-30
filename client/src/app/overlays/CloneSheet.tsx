import { useEffect, useRef, useState } from 'react';
import type { AgentFlag, AppConfig, RunMode, TerminalEngine } from '@argus/shared';
import { Copy, GitBranch } from 'lucide-react';
import { api } from '../../services/api.js';
import { Toggle } from '../../components/primitives/index.js';
import { AgentTabs } from '../ui/AgentTabs.js';
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
import { TerminalChoice } from '../ui/TerminalChoice.js';
import { kindOf, settingsFor } from '../ui/terminalKind.js';
import { BUILTIN_AGENTS } from '../../constants/builtinAgents.js';

interface CloneSheetProps {
  config: AppConfig | null;
  folderPath: string;
  currentAgentType?: string;
  currentTerminalEngine?: TerminalEngine;
  currentRunMode?: RunMode;
  onClose: () => void;
  onClone: (folderPath: string, agentType: string, flags: string[], worktreeBranch?: string, terminalEngine?: TerminalEngine, runMode?: RunMode) => Promise<void>;
  onSaveFlag?: (agentId: string, flag: AgentFlag) => Promise<void>;
}

export function CloneSheet({
  config,
  folderPath,
  currentAgentType,
  currentTerminalEngine,
  currentRunMode,
  onClose,
  onClone,
  onSaveFlag,
}: CloneSheetProps) {
  const [agentId, setAgentId] = useState<string>(currentAgentType ?? config?.defaultAgent ?? 'claude');
  // A clone inherits the SOURCE session's engine first — cloning a native session
  // and silently getting a web one back would be surprising — falling back to the
  // app default, then 'web', only when the source never had a preference.
  const [terminalEngine, setTerminalEngine] = useState<TerminalEngine>(
    currentTerminalEngine ?? config?.defaultTerminalEngine ?? 'web',
  );
  // Same reasoning as terminalEngine: the source's run mode wins, then the app
  // default, then persistent.
  const [runMode, setRunMode] = useState<RunMode>(
    currentRunMode ?? config?.defaultRunMode ?? 'persistent',
  );
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

  const agents = config ? [...BUILTIN_AGENTS, ...config.customAgents] : BUILTIN_AGENTS;
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
      await onClone(folderPath, agentId, flags, branch || undefined, terminalEngine, runMode);
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
      if (e.key !== 'Enter') return;
      // Enter confirms (⌘↵ too). Skip TEXTAREA; the flag input stops propagation
      // so its Enter adds a flag instead of submitting the clone.
      const t = document.activeElement as HTMLElement | null;
      if (t && t.tagName === 'TEXTAREA') return;
      e.preventDefault();
      submitRef.current();
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
      width={880}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 'var(--s-5)', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
            <Field label="Folder" hint="locked — clones inherit folder">
              <TextInput value={folderPath} mono disabled />
            </Field>

            <Field label="Agent" required>
              <AgentTabs agents={agents} value={agentId} onChange={setAgentId} />
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
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleAddFlag(); } }}
                      />
                    </div>
                    <Button variant="outline" size="md" disabled={!newFlag.trim()} onClick={handleAddFlag}>+ Add</Button>
                  </div>
                )}
              </div>
            </Field>

          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
            <Field label="Terminal">
              <TerminalChoice
                value={kindOf(runMode, terminalEngine)}
                onChange={(k) => {
                  const next = settingsFor(k);
                  setRunMode(next.runMode);
                  setTerminalEngine(next.terminalEngine);
                }}
              />
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

          </div>
        </div>

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
