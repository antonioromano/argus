import { useCallback, useEffect, useState } from 'react';
import {
  AUTO_APPROVAL_TOOLS,
  type AutoApprovalFolder,
  type AutoApprovalFolderState,
  type AutoApprovalRule,
  type AutoApprovalTool,
} from '@argus/shared';
import { Button, Section, SettingRow, Segmented, TextInput, Toggle, pushToast } from '../../../../components/primitives/index.js';
import { api } from '../../../../services/api.js';
import type { PaneProps } from '../types.js';

const TOOLS = Object.keys(AUTO_APPROVAL_TOOLS) as AutoApprovalTool[];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

function describeRule(r: AutoApprovalRule): string {
  return AUTO_APPROVAL_TOOLS[r.tool] === 'command' ? `${r.tool}: ${r.bashPrefix} …` : `${r.tool}: ${r.pathGlob ?? '**'}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

/**
 * F5: per-folder rules that let Argus answer Claude's PreToolUse hook with
 * "allow". Rules never deny and never override the user's own Claude
 * settings; unmatched calls fall through to Claude's normal prompt. The
 * server owns the rules and makes every decision — this pane only edits them.
 */
export function AutoApprovalPane({ config, onSave }: PaneProps) {
  const enabled = config.autoApprovalEnabled === true;
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [folders, setFolders] = useState<AutoApprovalFolder[] | null>(null);
  const [folder, setFolder] = useState<string>('');
  const [state, setState] = useState<AutoApprovalFolderState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<AutoApprovalTool>('Bash');
  const [pattern, setPattern] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const loadFolders = useCallback(() => api.getAutoApprovalFolders().then(
    (list) => {
      setFolders(list);
      setLoadError(null);
      setFolder((cur) => (cur && list.some((f) => f.folder === cur) ? cur : list[0]?.folder ?? ''));
    },
    (e: unknown) => setLoadError(errMsg(e)),
  ), []);

  const loadRules = useCallback((f: string) => {
    if (!f) return Promise.resolve().then(() => setState(null));
    return api.getAutoApprovalRules(f).then(
      (s) => { setState(s); setLoadError(null); },
      (e: unknown) => setLoadError(errMsg(e)),
    );
  }, []);

  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => { void loadRules(folder); }, [folder, loadRules]);

  const isCommand = AUTO_APPROVAL_TOOLS[tool] === 'command';

  const add = async () => {
    setAddError(null);
    setBusy(true);
    try {
      await api.addAutoApprovalRule(isCommand
        ? { folder, tool, bashPrefix: pattern }
        : { folder, tool, pathGlob: pattern.trim() || undefined });
      setPattern('');
      await Promise.all([loadRules(folder), loadFolders()]);
    } catch (e) {
      setAddError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmRemove(null);
    try {
      await api.removeAutoApprovalRule(folder, id);
    } catch (e) {
      pushToast(errMsg(e), 'danger');
    }
    await Promise.all([loadRules(folder), loadFolders()]);
  };

  return (
    <>
      <Section title="Auto-approval">
        <SettingRow
          label="Auto-approve matching tool calls"
          hint="Claude sessions only. A rule can only allow; anything it does not match still asks, and your own Claude deny and ask rules still apply."
        >
          <Toggle
            checked={enabled}
            onChange={(v) => {
              if (v) setConfirmEnable(true);
              else { setConfirmEnable(false); void onSave({ autoApprovalEnabled: false }); }
            }}
          />
        </SettingRow>
        {confirmEnable && !enabled && (
          <div className="settings-card-pad" role="alertdialog" aria-label="Confirm auto-approval"
            style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--t-xs)', color: 'var(--fg-1)' }}>
            <span style={{ flex: 1 }}>Tool calls matching your rules will run without asking. Turn on?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnable(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => { setConfirmEnable(false); void onSave({ autoApprovalEnabled: true }); }}>
              Turn on
            </Button>
          </div>
        )}
      </Section>

      <Section
        title="Rules"
        action={<Button size="sm" variant="ghost" onClick={() => { void loadFolders(); void loadRules(folder); }}>Refresh</Button>}
      >
        <div className="settings-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)', fontSize: 'var(--t-xs)' }}>
          {loadError && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{loadError}</p>}
          {folders && folders.length === 0 && (
            <p style={{ margin: 0, color: 'var(--fg-3)' }}>No session folders yet. Open a session to add rules for its folder.</p>
          )}
          {folders && folders.length > 0 && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--fg-2)' }}>
              Folder
              <select
                aria-label="Folder"
                value={folder}
                onChange={(e) => { setConfirmRemove(null); setFolder(e.target.value); }}
                style={{ flex: 1, minWidth: 0, height: 28, background: 'var(--bg-3)', color: 'var(--fg-0)', border: '1px solid var(--line-3)', borderRadius: 'var(--r-2)' }}
              >
                {folders.map((f) => (
                  <option key={f.folder} value={f.folder} title={f.folder}>
                    {base(f.folder)} — {f.folder}{f.ruleCount ? ` (${f.ruleCount})` : ''}{f.hasSession ? '' : ' · no live session'}
                  </option>
                ))}
              </select>
            </label>
          )}

          {state && (
            <>
              {state.rules.length === 0 && (
                <p style={{ margin: 0, color: 'var(--fg-3)' }}>No rules for this folder. Nothing is auto-approved here.</p>
              )}
              {state.rules.map((r) => (
                <div key={r.id} data-testid="aa-rule" style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 28 }}>
                  <code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', color: 'var(--fg-0)' }}>
                    {describeRule(r)}
                  </code>
                  {confirmRemove === r.id ? (
                    <>
                      <span style={{ color: 'var(--fg-1)' }}>Remove?</span>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                      <Button size="sm" variant="danger" onClick={() => { void remove(r.id); }}>Remove</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(r.id)}>Remove…</Button>
                  )}
                </div>
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line-2)' }}>
                <Segmented
                  label="Tool"
                  compact
                  value={tool}
                  options={TOOLS.map((t) => ({ value: t, label: t }))}
                  onChange={(t) => { setTool(t); setAddError(null); }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <TextInput
                    mono
                    value={pattern}
                    onChange={setPattern}
                    placeholder={isCommand ? 'Command prefix, e.g. npm test' : 'Path glob in this folder, e.g. src/** (blank = any)'}
                    error={!!addError}
                    spellCheck={false}
                    autoCapitalize="off"
                    style={{ flex: 1 }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void add(); }}
                  />
                  <Button size="sm" onClick={() => { void add(); }} loading={busy} disabled={isCommand && !pattern.trim()}>
                    Add rule
                  </Button>
                </div>
                {addError && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{addError}</p>}
                <p style={{ margin: 0, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                  {isCommand
                    ? 'Matches the command or the prefix followed by arguments. Commands with ; & | ` $ < > or a newline always ask. Keep prefixes narrow: "git" would allow any git command.'
                    : 'Matches paths inside this folder only (symlinks are resolved). Writes to .git, .claude and .mcp.json always ask.'}
                </p>
              </div>
            </>
          )}
        </div>
      </Section>

      {state && (
        <Section title="Recent auto-approvals">
          <div className="settings-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--t-xs)' }}>
            {state.audit.length === 0 && <p style={{ margin: 0, color: 'var(--fg-3)' }}>None yet for this folder.</p>}
            {state.audit.map((a, i) => (
              <div key={`${a.at}-${i}`} data-testid="aa-audit" style={{ display: 'flex', gap: 8, color: 'var(--fg-2)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{formatTime(a.at)}</span>
                <span style={{ color: 'var(--fg-1)' }}>{a.tool}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }} title={a.summary}>
                  {a.summary}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
