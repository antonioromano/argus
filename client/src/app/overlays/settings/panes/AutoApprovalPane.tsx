import { useCallback, useEffect, useState } from 'react';
import {
  AUTO_APPROVAL_TOOLS,
  type AutoApprovalFolder,
  type AutoApprovalFolderState,
  type AutoApprovalRule,
  type AutoApprovalTool,
} from '@argus/shared';
import { AlertSheet, Button, Section, Segmented, TextInput, Toggle, Stack, Row, Text } from '../../../../components/primitives/index.js';
import { useDeferredRemove } from '../../../../hooks/useDeferredRemove.js';
import { PaneLoadState } from '../PaneLoadState.js';
import { api } from '../../../../services/api.js';
import type { PaneProps } from '../types.js';
import { SettingField } from '../SettingField.js';

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
/** Permission modes in which rules act (mirrors the server's ACTIVE_MODES). */
const RULE_MODES = ['default', 'acceptEdits'];

export function AutoApprovalPane({ config, onSave }: PaneProps) {
  const enabled = config.autoApprovalEnabled === true;
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [folders, setFolders] = useState<AutoApprovalFolder[] | null>(null);
  const [folder, setFolder] = useState<string>('');
  const [state, setState] = useState<AutoApprovalFolderState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tool, setTool] = useState<AutoApprovalTool>('Bash');
  const [pattern, setPattern] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hidden, remove: deferRemove } = useDeferredRemove();
  const [claudeMode, setClaudeMode] = useState<string | null>(null);

  const loadFolders = useCallback(() => api.getAutoApprovalFolders().then(
    (list) => {
      setFolders(list);
      setLoadError(null);
      setFolder((cur) => (cur && list.some((f) => f.folder === cur) ? cur : list[0]?.folder ?? ''));
    },
    (e: unknown) => setLoadError(e ?? new Error('Couldn’t load auto-approval folders')),
  ), []);

  const loadRules = useCallback((f: string) => {
    if (!f) return Promise.resolve().then(() => setState(null));
    return api.getAutoApprovalRules(f).then(
      (s) => { setState(s); setLoadError(null); },
      (e: unknown) => setLoadError(e ?? new Error('Couldn’t load the rules')),
    );
  }, []);

  useEffect(() => { void loadFolders(); }, [loadFolders]);
  useEffect(() => { api.getClaudeDefaultMode().then(setClaudeMode, () => setClaudeMode(null)); }, []);
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

  // Deferred: re-creating a rule would give it a new id.
  const remove = (r: AutoApprovalRule) => {
    const from = folder;
    deferRemove(r.id, {
      message: `Removed rule ${describeRule(r)}`,
      commit: () => api.removeAutoApprovalRule(from, r.id),
      onCommitted: () => { void Promise.all([loadRules(from), loadFolders()]); },
    });
  };

  return (
    <>
      <Section title="Auto-approval">
        <SettingField id="autoApprovalEnabled">
          <Toggle
            checked={enabled}
            onChange={(v) => {
              if (v) setConfirmEnable(true);
              else { setConfirmEnable(false); void onSave({ autoApprovalEnabled: false }); }
            }}
          />
        </SettingField>
        <AlertSheet
          isOpen={confirmEnable && !enabled}
          title="Turn on auto-approval?"
          message="Tool calls matching your rules will run without asking."
          confirmLabel="Turn on"
          onConfirm={() => { setConfirmEnable(false); void onSave({ autoApprovalEnabled: true }); }}
          onCancel={() => setConfirmEnable(false)}
        />
      </Section>

      <Section
        title="Rules"
        action={<Button size="sm" variant="ghost" onClick={() => { void loadFolders(); void loadRules(folder); }}>Refresh</Button>}
      >
        <Stack gap={3} className="settings-card-pad" style={{ fontSize: 'var(--t-xs)' }}>
          {enabled && claudeMode && !RULE_MODES.includes(claudeMode) && (
            <p role="status" data-testid="auto-approval-inactive" style={{ margin: 0, color: 'var(--warning, var(--fg-2))' }}>
              Inactive for your sessions: your Claude default permission mode is <code>{claudeMode}</code>. Rules only act in
              <code> default</code> and <code>acceptEdits</code> modes, where an allow means skipping a prompt you would otherwise see.
            </p>
          )}
          <PaneLoadState
            loaded={folders !== null}
            error={loadError}
            errorTitle="Couldn’t load auto-approval rules"
            onRetry={() => { void loadFolders().then(() => loadRules(folder)); }}
          />
          {folders && folders.length === 0 && !loadError && (
            <Text as="p" tone="faint">No session folders yet. Open a session to add rules for its folder.</Text>
          )}
          {folders && folders.length > 0 && (
            <Row as="label" gap={2} style={{ color: 'var(--fg-2)' }}>
              Folder
              <select
                aria-label="Folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                style={{ flex: 1, minWidth: 0, height: 28, background: 'var(--bg-3)', color: 'var(--fg-0)', border: '1px solid var(--line-3)', borderRadius: 'var(--r-2)' }}
              >
                {folders.map((f) => (
                  <option key={f.folder} value={f.folder} title={f.folder}>
                    {base(f.folder)} — {f.folder}{f.ruleCount ? ` (${f.ruleCount})` : ''}{f.hasSession ? '' : ' · no live session'}
                  </option>
                ))}
              </select>
            </Row>
          )}

          {state && (
            <>
              {state.rules.every((r) => hidden.has(r.id)) && (
                <Text as="p" tone="faint">No rules for this folder. Nothing is auto-approved here.</Text>
              )}
              {state.rules.filter((r) => !hidden.has(r.id)).map((r) => (
                <Row gap={2} key={r.id} data-testid="aa-rule" style={{ minHeight: 28 }}>
                  <code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', color: 'var(--fg-0)' }}>
                    {describeRule(r)}
                  </code>
                  <Button size="sm" variant="ghost" onClick={() => remove(r)}>Remove</Button>
                </Row>
              ))}

              <Stack gap={2} style={{ paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line-2)' }}>
                <Segmented
                  label="Tool"
                  compact
                  value={tool}
                  options={TOOLS.map((t) => ({ value: t, label: t }))}
                  onChange={(t) => { setTool(t); setAddError(null); }}
                />
                <Row gap={2}>
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
                </Row>
                {addError && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{addError}</p>}
                <p style={{ margin: 0, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                  {isCommand
                    ? 'Matches the command or the prefix followed by arguments. Commands with ; & | ` $ < > or a newline always ask. Keep prefixes narrow: "git" would allow any git command.'
                    : 'Matches paths inside this folder only (symlinks are resolved). Writes to .git, .claude and .mcp.json always ask.'}
                </p>
              </Stack>
            </>
          )}
        </Stack>
      </Section>

      {state && (
        <Section title="Recent auto-approvals">
          <Stack gap={1} className="settings-card-pad" style={{ fontSize: 'var(--t-xs)' }}>
            {state.audit.length === 0 && <Text as="p" tone="faint">None yet for this folder.</Text>}
            {state.audit.map((a, i) => (
              <Row align="stretch" gap={2} key={`${a.at}-${i}`} data-testid="aa-audit" style={{ color: 'var(--fg-2)' }}>
                <Text mono tone="faint">{formatTime(a.at)}</Text>
                <Text tone="default">{a.tool}</Text>
                <Text mono truncate style={{ flex: 1 }} title={a.summary}>
                  {a.summary}
                </Text>
              </Row>
            ))}
          </Stack>
        </Section>
      )}
    </>
  );
}
