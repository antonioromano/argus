import { useEffect, useRef, useState } from 'react';
import { SHELL_AGENT_ID, type AgentDefinition, type SessionInfo } from '@argus/shared';
import { X, CornerDownLeft, FolderSearch } from 'lucide-react';
import { api } from '../../services/api.js';
import { useConfig } from '../../hooks/useConfig.js';
import { FolderBrowser } from './FolderBrowser.js';
import { Switch, Icon, Row, Stack, Text } from '../../components/primitives/index.js';

interface CreateSheetProps {
  sessions: SessionInfo[];
  onCreate: (
    folderPath: string, name: string | undefined, agentType: string | undefined,
    flags: string[], worktreeBranch?: string, worktreeBase?: string,
  ) => Promise<void>;
  onClose: () => void;
}

const BUILTIN_AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
  { id: SHELL_AGENT_ID, name: 'Shell', command: '$SHELL', builtin: true },
];

/** Mobile create-session sheet. No native folder picker on a phone, so the
 *  folder field is path autocomplete + a recent-folders quick-pick. */
export function CreateSheet({ sessions, onCreate, onClose }: CreateSheetProps) {
  const { config } = useConfig();
  const agents = config ? [...BUILTIN_AGENTS, ...config.customAgents] : BUILTIN_AGENTS;

  const [folderPath, setFolderPath] = useState('');
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState<string>(config?.defaultAgent ?? 'claude');
  const [completions, setCompletions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  // Worktree
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [useWorktree, setUseWorktree] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [worktreeBase, setWorktreeBase] = useState('');
  const [repoBranches, setRepoBranches] = useState<string[]>([]);
  const autoBranchRef = useRef('');
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recent folders: distinct paths from existing sessions, most-recent first.
  const recents = Array.from(new Set(sessions.map((s) => s.folderPath))).slice(0, 6);

  // Reset git status the moment the path changes (before debounced detection).
  const folderTrimmed = folderPath.trim();
  const [gitCheckedFolder, setGitCheckedFolder] = useState(folderTrimmed);
  if (gitCheckedFolder !== folderTrimmed) {
    setGitCheckedFolder(folderTrimmed);
    setIsGitRepo(null);
    setUseWorktree(false);
  }

  // Debounced path autocomplete.
  useEffect(() => {
    if (acTimer.current) clearTimeout(acTimer.current);
    const p = folderPath.trim();
    acTimer.current = setTimeout(() => {
      if (!p) { setCompletions([]); return; }
      api.getPathCompletions(p).then(setCompletions).catch(() => setCompletions([]));
    }, 200);
    return () => { if (acTimer.current) clearTimeout(acTimer.current); };
  }, [folderPath]);

  // Debounced git-repo detection → auto branch + base picker.
  useEffect(() => {
    if (gitTimer.current) clearTimeout(gitTimer.current);
    const folder = folderPath.trim();
    if (!folder) return;
    gitTimer.current = setTimeout(async () => {
      try {
        const result = await api.checkWorktree({ repoPath: folder });
        setIsGitRepo(result.isGitRepo);
        if (result.isGitRepo) {
          const sessionName = name.trim() || folder.split('/').pop() || 'session';
          const slug = sessionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const auto = `argus/${slug}`;
          setBranchName((prev) => (prev === autoBranchRef.current || prev === '') ? auto : prev);
          autoBranchRef.current = auto;
          try {
            const b = await api.listBranchesForRepo(folder);
            setRepoBranches(b.branches);
            setWorktreeBase((prev) => prev || b.currentBranch || 'HEAD');
          } catch { /* base falls back to HEAD */ }
        }
      } catch {
        setIsGitRepo(false);
      }
    }, 300);
    return () => { if (gitTimer.current) clearTimeout(gitTimer.current); };
  }, [folderPath]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const canCreate = folderTrimmed.length > 0 && !creating;

  const submit = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(
        folderTrimmed,
        name.trim() || undefined,
        agentId,
        [],
        useWorktree ? branchName.trim() : undefined,
        useWorktree ? (worktreeBase || 'HEAD') : undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t create the session');
      setCreating(false);
    }
  };

  return (
    <Stack
      onClick={onClose}
      className="glass-overlay"
      justify="end"
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-sheet)',
        background: 'var(--bg-overlay)', animation: 'argus-fade-in var(--dur-fast) var(--ease)',
      }}
    >
      <Stack
        role="dialog"
        aria-modal="true"
        aria-label="New session"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: '92%',
          background: 'var(--bg-1)', borderTop: '1px solid var(--line-3)',
          borderRadius: 'var(--r-4) var(--r-4) 0 0', boxShadow: 'var(--shadow-sheet)',
          animation: 'argus-sheet-up var(--dur-base) var(--ease)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 'var(--r-1)', background: 'var(--line-3)', margin: 'var(--s-2) auto var(--s-1)' }} />
        <Row justify="between" style={{ padding: 'var(--s-2) var(--s-4) var(--s-3)', borderBottom: '1px solid var(--line-1)' }}>
          <span className="eyebrow" style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>NEW SESSION</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--fg-2)', cursor: 'pointer', padding: 'var(--s-1)' }}>
            <Icon icon={X} size="xl" />
          </button>
        </Row>

        <div className="argus-scroll" style={{ overflowY: 'auto', padding: 'var(--s-4)' }}>
          {/* Folder */}
          <Label>Folder</Label>
          <Row align="stretch" gap={2}>
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="~/dev/projects/…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <button
              onClick={() => setBrowsing(true)}
              aria-label="Browse folders"
              style={{ flexShrink: 0, width: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', color: 'var(--accent)', cursor: 'pointer' }}
            >
              <Icon icon={FolderSearch} size="xl" />
            </button>
          </Row>
          {completions.length > 0 && folderTrimmed && completions[0] !== folderTrimmed && (
            <div style={{ marginTop: 'var(--s-1)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', overflow: 'hidden', background: 'var(--bg-2)' }}>
              {completions.slice(0, 4).map((c) => (
                <button
                  key={c}
                  onClick={() => setFolderPath(c)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--s-2) var(--s-3)', background: 'none', border: 'none', borderBottom: '1px solid var(--line-1)', color: 'var(--fg-1)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {recents.length > 0 && (
            <Row wrap align="stretch" gap={1.5} style={{ marginTop: 'var(--s-2)' }}>
              {recents.map((r) => (
                <button
                  key={r}
                  onClick={() => setFolderPath(r)}
                  title={r}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', padding: 'var(--s-1-5) var(--s-2)', borderRadius: 'var(--r-pill)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--fg-2)', cursor: 'pointer', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {r.split('/').filter(Boolean).pop()}
                </button>
              ))}
            </Row>
          )}

          {/* Name */}
          <Label style={{ marginTop: 'var(--s-4)' }}>Name <span style={{ color: 'var(--fg-4)' }}>(optional)</span></Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={folderTrimmed ? folderTrimmed.split('/').filter(Boolean).pop() : 'auto from folder'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            style={inputStyle}
          />

          {/* Agent */}
          <Label style={{ marginTop: 'var(--s-4)' }}>Agent</Label>
          <Row wrap align="stretch" gap={1.5}>
            {agents.map((a) => {
              const sel = agentId === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAgentId(a.id)}
                  style={{
                    flex: '1 1 30%', minWidth: 80, textAlign: 'center', padding: 'var(--s-3) var(--s-1)',
                    borderRadius: 'var(--r-2)', cursor: 'pointer',
                    border: `1px solid ${sel ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                    background: sel ? 'var(--accent-bg)' : 'var(--bg-2)',
                    color: sel ? 'var(--accent)' : 'var(--fg-2)',
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', fontWeight: sel ? 600 : 400,
                  }}
                >
                  {a.name}
                </button>
              );
            })}
          </Row>

          {/* Worktree */}
          {isGitRepo && (
            <>
              <Label style={{ marginTop: 'var(--s-4)' }}>Git worktree</Label>
              <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', background: 'var(--bg-2)', padding: 'var(--s-3)' }}>
                <button
                  onClick={() => setUseWorktree((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <span style={{ textAlign: 'left' }}>
                    <Text size="body" weight={500} style={{ display: 'block', fontFamily: 'var(--font-sans)', color: 'var(--fg-0)' }}>Isolate in a worktree</Text>
                    <Text size="caption" tone="faint" style={{ display: 'block' }}>git repo detected</Text>
                  </span>
                  <Switch on={useWorktree} />
                </button>
                {useWorktree && (
                  <>
                    <input
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder="argus/my-feature"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      style={{ ...inputStyle, marginTop: 'var(--s-3)' }}
                    />
                    {repoBranches.length > 0 && (
                      <select
                        value={worktreeBase}
                        onChange={(e) => setWorktreeBase(e.target.value)}
                        style={{ ...inputStyle, marginTop: 'var(--s-2)' }}
                      >
                        {!repoBranches.includes(worktreeBase) && <option value={worktreeBase}>{worktreeBase || 'HEAD'}</option>}
                        {repoBranches.map((b) => <option key={b} value={b}>base: {b}</option>)}
                      </select>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {error && (
            <Text as="div" mono size="body" tone="danger" style={{ marginTop: 'var(--s-3)' }}>{error}</Text>
          )}
        </div>

        <div style={{ padding: 'var(--s-3) var(--s-4)', borderTop: '1px solid var(--line-1)', background: 'var(--bg-1)' }}>
          <button
            onClick={submit}
            disabled={!canCreate}
            style={{
              width: '100%', padding: 'var(--s-3)', borderRadius: 'var(--r-2)', border: 'none',
              background: canCreate ? 'var(--accent)' : 'var(--bg-3)',
              color: canCreate ? 'var(--fg-on-accent)' : 'var(--fg-4)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--t-md)', fontWeight: 700,
              cursor: canCreate ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--s-1-5)',
            }}
          >
            <Icon icon={CornerDownLeft} size="lg" strokeWidth={2} />
            {creating ? 'Creating…' : 'Create session'}
          </button>
        </div>

        {browsing && (
          <FolderBrowser
            initialPath={folderTrimmed || undefined}
            onSelect={(p) => { setFolderPath(p); setBrowsing(false); }}
            onClose={() => setBrowsing(false)}
          />
        )}
      </Stack>
    </Stack>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: 'var(--s-3) var(--s-3)', background: 'var(--bg-2)',
  border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', color: 'var(--fg-0)',
  fontFamily: 'var(--font-mono)', fontSize: 16, // 16px avoids iOS input-zoom
};

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="eyebrow" style={{ display: 'block', fontSize: 'var(--t-micro)', color: 'var(--fg-3)', marginBottom: 'var(--s-1-5)', ...style }}>
      {children}
    </div>
  );
}

