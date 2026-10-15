import { useEffect, useMemo, useState } from 'react';
import { Forward } from 'lucide-react';
import { SHELL_AGENT_ID, type AppConfig, type HandoffPreviewResponse, type SessionInfo } from '@argus/shared';
import { Button, Checkbox, Field, Sheet, TextInput } from '../../components/primitives/index.js';
import { BUILTIN_AGENTS } from '../../constants/builtinAgents.js';
import { AgentTabs } from '../ui/AgentTabs.js';
import { api } from '../../services/api.js';
import { isBetaEnabled } from '../../utils/betaFlags.js';
import { workRoot } from '../../utils/workRoot.js';
import { HANDOFF_DEFAULT_MESSAGES, HANDOFF_MAX_MESSAGES, formatBytes } from './handoff.js';

/**
 * Beta F12 — "Hand off…" a shell to a new one. The server assembles a brief
 * (git status, diff stat, capped diff, the tail of a Claude transcript, the
 * note) without any model call, writes it under the app data dir, and starts
 * the new shell with "Read the handoff brief at <path> …" as its first prompt.
 * Mounted only while `betaHandoff` is on (ArgusApp gates it).
 */

const PREVIEW_DEBOUNCE_MS = 300;

interface HandoffSheetProps {
  session: SessionInfo;
  config: Partial<AppConfig> | null | undefined;
  onClose: () => void;
  /** The new shell exists; the host claims and focuses it. */
  onCreated: (session: SessionInfo) => void;
}

/** What ArgusApp mounts: the sheet, but only while the beta flag is on. Flag off ⇒ nothing, no requests. */
export function HandoffHost({ config, session, ...rest }: Omit<HandoffSheetProps, 'session'> & { session: SessionInfo | null }) {
  if (!isBetaEnabled(config, 'betaHandoff') || !session) return null;
  return <HandoffSheet session={session} config={config} {...rest} />;
}

export function HandoffSheet({ session, config, onClose, onCreated }: HandoffSheetProps) {
  const agents = useMemo(
    () => [...BUILTIN_AGENTS, ...(config?.customAgents ?? [])].filter((a) => a.id !== SHELL_AGENT_ID),
    [config?.customAgents],
  );
  const [agentId, setAgentId] = useState(() => {
    const preferred = session.agentType !== SHELL_AGENT_ID ? session.agentType : (config?.defaultAgent ?? 'claude');
    return agents.some((a) => a.id === preferred) ? preferred : (agents[0]?.id ?? 'claude');
  });
  const [folderPath, setFolderPath] = useState(() => workRoot(session));
  const [messageCount, setMessageCount] = useState(HANDOFF_DEFAULT_MESSAGES);
  const [includeDiff, setIncludeDiff] = useState(true);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<HandoffPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isClaudeSource = session.agentType === 'claude';

  // Debounced size preview; the server builds the same brief it would write.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api.previewHandoff(session.id, { agentType: agentId, folderPath: folderPath.trim(), messageCount, includeDiff, note }, ctrl.signal)
        .then((p) => { setPreview(p); setPreviewError(null); })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : 'Preview failed');
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [session.id, agentId, folderPath, messageCount, includeDiff, note]);

  const folderMissing = !folderPath.trim();
  const canSubmit = !submitting && !folderMissing && !!agentId;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.handoffSession(session.id, { agentType: agentId, folderPath: folderPath.trim(), messageCount, includeDiff, note });
      onCreated(res.session);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handoff failed');
      setSubmitting(false);
    }
  };

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%' }}>
      <span data-testid="handoff-preview" style={{ fontSize: 'var(--t-xs)', color: previewError ? 'var(--danger)' : 'var(--fg-3)', flex: 1, minWidth: 0 }}>
        {previewError
          ? previewError
          : preview
            ? `Brief ≈ ${formatBytes(preview.bytes)}${isClaudeSource ? ` · ${preview.messages} message${preview.messages === 1 ? '' : 's'}` : ''}${!preview.isGitRepo ? ' · not a git repo' : ''}${preview.diffTruncated ? ' · diff truncated' : ''}`
            : 'Measuring the brief…'}
      </span>
      <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>Cancel</Button>
      <Button variant="primary" size="md" icon={Forward} onClick={() => { void submit(); }} disabled={!canSubmit} loading={submitting}>
        Hand off
      </Button>
    </div>
  );

  return (
    <Sheet eyebrow="HAND OFF" title={session.name} width={560} onClose={submitting ? undefined : onClose} footer={footer}>
      <div data-testid="handoff-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-2)' }}>
          Starts a new shell that reads a brief of this one: git status, diff stat
          {includeDiff ? ' and diff' : ''}{isClaudeSource ? ', the recent conversation' : ''} and your note. No model call, no extra tokens.
        </div>

        <Field label="Agent">
          <AgentTabs agents={agents} value={agentId} onChange={setAgentId} />
        </Field>

        <Field label="Folder" error={folderMissing ? 'Pick a folder' : undefined}>
          <TextInput mono value={folderPath} onChange={setFolderPath} error={folderMissing} spellCheck={false} />
        </Field>

        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', fontSize: 'var(--t-sm)', color: isClaudeSource ? 'var(--fg-0)' : 'var(--fg-3)' }}>
            Last
            <input
              data-testid="handoff-count"
              type="number"
              min={0}
              max={HANDOFF_MAX_MESSAGES}
              value={messageCount}
              disabled={!isClaudeSource}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                setMessageCount(Number.isFinite(n) ? Math.min(HANDOFF_MAX_MESSAGES, Math.max(0, n)) : 0);
              }}
              style={{
                width: 56, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-0)',
                background: 'var(--bg-inset)', border: '1px solid var(--line-3)', borderRadius: 'var(--r-2)', padding: '2px 6px',
              }}
            />
            messages{!isClaudeSource && ' (Claude shells only)'}
          </label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', fontSize: 'var(--t-sm)' }} data-testid="handoff-diff">
            <Checkbox checked={includeDiff} onChange={setIncludeDiff} />
            Include diff (up to 30 KB)
          </span>
        </div>

        <label style={{ display: 'block' }}>
          <span className="eyebrow" style={{ color: 'var(--fg-2)' }}>Note</span>
          <textarea
            data-testid="handoff-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What should the new shell do next?"
            style={{
              display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, resize: 'vertical',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-0)',
              background: 'var(--bg-inset)', border: '1px solid var(--line-3)', borderRadius: 'var(--r-2)', padding: 'var(--s-2)',
            }}
          />
        </label>

        {error && (
          <div role="alert" style={{ padding: 'var(--s-2) var(--s-3)', background: 'var(--danger-bg)', borderRadius: 'var(--r-2)', fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}
