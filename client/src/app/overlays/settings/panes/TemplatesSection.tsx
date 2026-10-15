import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  TEMPLATE_MAX_SPECS,
  TEMPLATE_NAME_MAX,
  TEMPLATE_PROMPT_MAX,
  type AppConfig,
  type LaunchTemplateResponse,
  type SessionTemplate,
} from '@argus/shared';
import { Button, Section, TextInput, pushToast } from '../../../../components/primitives/index.js';
import { BUILTIN_AGENTS } from '../../../../constants/builtinAgents.js';
import { api, TemplateApiError } from '../../../../services/api.js';
import { myWindowId } from '../../../../utils/windowId.js';
import { base, blankSpec, describeSpec, fromTemplate, toRequest, type Draft, type DraftSpec } from './templateDraft.js';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Beta F10 — multi-session templates. A template is 1–8 shells (agent, folder,
 * optional new worktree branch, optional first prompt, optional name) started
 * together into a new group. Rendered inside the Launchers pane only while
 * `betaSessionTemplates` is on; the server validates every spec on save and
 * again on launch, so the editor only mirrors the limits.
 */

const selectStyle = { height: 32, background: 'var(--bg-3)', color: 'var(--fg-0)', border: '1px solid var(--line-3)', borderRadius: 'var(--r-2)' } as const;

/** Folder field with the server's folder autocomplete (debounced) and the native picker. */
function FolderInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  const listId = useId();
  const [completions, setCompletions] = useState<string[]>([]);
  useEffect(() => {
    const p = value.trim();
    let live = true;
    const t = setTimeout(() => {
      if (!p.startsWith('/') && !p.startsWith('~')) { setCompletions([]); return; }
      api.getPathCompletions(p).then((c) => { if (live) setCompletions(c); }, () => { if (live) setCompletions([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [value]);
  const browse = async () => {
    try {
      const p = await api.pickFolder();
      if (p) onChange(p);
    } catch (e) { pushToast(errMsg(e), 'danger'); }
  };
  return (
    <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
      <TextInput value={value} onChange={onChange} placeholder="/absolute/path/to/repo" mono list={listId} error={error} style={{ flex: 1 }} />
      <datalist id={listId}>{completions.slice(0, 20).map((c) => <option key={c} value={c} />)}</datalist>
      <Button size="sm" variant="ghost" onClick={() => void browse()}>Browse…</Button>
    </div>
  );
}

function TemplateEditor({ draft, agents, onCancel, onSaved }: {
  draft: Draft;
  agents: { id: string; name: string }[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [specErrors, setSpecErrors] = useState<Record<number, string>>({});
  const setSpec = (i: number, patch: Partial<DraftSpec>) =>
    setD((prev) => ({ ...prev, specs: prev.specs.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const removeSpec = (i: number) => {
    setD((prev) => ({ ...prev, specs: prev.specs.filter((_, j) => j !== i) }));
    setSpecErrors({});
  };
  const addSpec = () => setD((prev) => ({ ...prev, specs: [...prev.specs, blankSpec(prev.specs.at(-1)?.agent ?? agents[0]?.id ?? 'claude')] }));
  const tooLong = d.specs.some((s) => s.prompt.length > TEMPLATE_PROMPT_MAX);
  const canSave = !saving && !!d.name.trim() && d.specs.length > 0 && d.specs.every((s) => s.folder.trim() && s.agent) && !tooLong;

  const save = async () => {
    setSaving(true);
    setError(null);
    setSpecErrors({});
    try {
      const req = toRequest(d);
      if (d.id) await api.updateTemplate(d.id, req);
      else await api.createTemplate(req);
      pushToast(`Saved ${req.name}`, 'ok');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      if (e instanceof TemplateApiError) setSpecErrors(Object.fromEntries(e.specErrors.map((x) => [x.index, x.error])));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="template-editor" className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <TextInput value={d.name} onChange={(name) => setD({ ...d, name: name.slice(0, TEMPLATE_NAME_MAX) })} placeholder="Template name, e.g. API + client + reviewer" />
      {d.specs.map((s, i) => (
        <div key={i} data-testid="template-spec" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: `1px solid ${specErrors[i] ? 'var(--danger)' : 'var(--line-2)'}`, borderRadius: 'var(--r-2)' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="setting-row-hint mono" style={{ width: 16 }}>{i + 1}</span>
            <select aria-label="Agent" value={s.agent} onChange={(e) => setSpec(i, { agent: e.target.value })} style={selectStyle}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              {!agents.some((a) => a.id === s.agent) && <option value={s.agent}>{s.agent} (missing)</option>}
            </select>
            <FolderInput value={s.folder} onChange={(folder) => setSpec(i, { folder })} error={!!specErrors[i]} />
            <span data-testid="template-spec-remove"><Button size="sm" variant="ghost" danger disabled={d.specs.length <= 1} onClick={() => removeSpec(i)}>Remove</Button></span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <TextInput value={s.name} onChange={(name) => setSpec(i, { name })} placeholder="Name (optional)" style={{ flex: 1 }} />
            <TextInput value={s.worktreeBranch} onChange={(worktreeBranch) => setSpec(i, { worktreeBranch })} placeholder="New worktree branch (optional)" mono style={{ flex: 1 }} />
          </div>
          <textarea
            aria-label="Initial prompt"
            rows={2}
            value={s.prompt}
            onChange={(e) => setSpec(i, { prompt: e.target.value })}
            placeholder="Initial prompt (optional)"
            style={{ background: 'var(--bg-3)', color: 'var(--fg-0)', border: `1px solid ${s.prompt.length > TEMPLATE_PROMPT_MAX ? 'var(--danger)' : 'var(--line-3)'}`, borderRadius: 'var(--r-2)', padding: 6, fontFamily: 'var(--font-sans)', resize: 'vertical' }}
          />
          {s.prompt.length > TEMPLATE_PROMPT_MAX * 0.9 && (
            <div className="setting-row-hint">{s.prompt.length} / {TEMPLATE_PROMPT_MAX} characters</div>
          )}
          {specErrors[i] && <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--t-xs)' }}>{specErrors[i]}</div>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span data-testid="template-spec-add"><Button size="sm" variant="ghost" disabled={d.specs.length >= TEMPLATE_MAX_SPECS} onClick={addSpec}>Add session</Button></span>
        <span className="setting-row-hint" style={{ flex: 1 }}>{d.specs.length} / {TEMPLATE_MAX_SPECS}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <span data-testid="template-save"><Button size="sm" variant="primary" disabled={!canSave} loading={saving} onClick={() => void save()}>Save template</Button></span>
      </div>
      {error && <div role="alert" data-testid="template-error" style={{ color: 'var(--danger)', fontSize: 'var(--t-xs)' }}>{error}</div>}
    </div>
  );
}

export function TemplatesSection({ config }: { config: AppConfig }) {
  const agents = useMemo(() => [...BUILTIN_AGENTS, ...(config.customAgents ?? [])], [config.customAgents]);
  const [list, setList] = useState<SessionTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [confirmLaunch, setConfirmLaunch] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [result, setResult] = useState<{ template: SessionTemplate; response: LaunchTemplateResponse } | null>(null);

  const refresh = useCallback(() => {
    api.listTemplates().then((l) => { setLoadError(null); setList(l); }, (e: unknown) => setLoadError(errMsg(e)));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (t: SessionTemplate) => {
    setConfirmDelete(null);
    try { await api.deleteTemplate(t.id); } catch (e) { pushToast(errMsg(e), 'danger'); return; }
    pushToast(`Deleted ${t.name}`, 'ok');
    refresh();
  };

  const launch = async (t: SessionTemplate) => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const response = await api.launchTemplate(t.id, myWindowId);
      setConfirmLaunch(null);
      setResult({ template: t, response });
    } catch (e) {
      setLaunchError(errMsg(e));
    } finally {
      setLaunching(false);
    }
  };

  const startNew = () => {
    setResult(null);
    setEditing({ id: null, name: '', specs: [blankSpec(config.defaultAgent && agents.some((a) => a.id === config.defaultAgent) ? config.defaultAgent : 'claude')] });
  };

  return (
    <Section
      title="Templates"
      action={!editing && (
        <span data-testid="template-new"><Button size="sm" variant="ghost" onClick={startNew}>New template</Button></span>
      )}
    >
      <div className="setting-row"><div className="setting-row-hint">
        Start up to {TEMPLATE_MAX_SPECS} shells at once into a new group — each in its own folder, optionally on a new worktree branch with a first prompt.
      </div></div>
      {loadError && <div className="setting-row" data-testid="templates-error"><div className="setting-row-hint">Could not load templates: {loadError}</div></div>}
      {editing && (
        <TemplateEditor
          key={editing.id ?? 'new'}
          draft={editing}
          agents={agents}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {list?.length === 0 && !editing && (
        <div className="setting-row"><div className="setting-row-hint">No templates yet.</div></div>
      )}
      {list?.map((t) => (
        <div key={t.id} data-testid="template-row" className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="setting-row-label">{t.name}</div>
              <div className="setting-row-hint">{t.specs.length} session{t.specs.length === 1 ? '' : 's'} · {t.specs.map((s) => s.name ?? base(s.folder)).join(', ')}</div>
            </div>
            <span data-testid="template-launch"><Button size="sm" variant="primary" disabled={launching} onClick={() => { setResult(null); setLaunchError(null); setConfirmLaunch(t.id); }}>Launch</Button></span>
            <span data-testid="template-edit"><Button size="sm" variant="ghost" onClick={() => { setResult(null); setEditing(fromTemplate(t)); }}>Edit</Button></span>
            {confirmDelete === t.id ? (
              <>
                <span className="setting-row-hint">Delete {t.name}?</span>
                <span data-testid="template-delete-confirm"><Button size="sm" variant="ghost" danger onClick={() => void remove(t)}>Confirm</Button></span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              </>
            ) : (
              <span data-testid="template-delete"><Button size="sm" variant="ghost" danger onClick={() => setConfirmDelete(t.id)}>Delete</Button></span>
            )}
          </div>

          {confirmLaunch === t.id && (
            <div data-testid="template-launch-confirm" style={{ marginTop: 8, padding: 8, border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)' }}>
              <div className="setting-row-label">Start {t.specs.length} shell{t.specs.length === 1 ? '' : 's'} into a new group “{t.name}”?</div>
              <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 'var(--t-xs)' }}>
                {t.specs.map((s, i) => <li key={i} className="mono" style={{ wordBreak: 'break-all' }}>{describeSpec(s)}</li>)}
              </ul>
              <div className="setting-row-hint">Each one is started on its own; one that fails does not stop or undo the others.</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <span data-testid="template-launch-go"><Button size="sm" variant="primary" loading={launching} onClick={() => void launch(t)}>Launch {t.specs.length}</Button></span>
                <Button size="sm" variant="ghost" disabled={launching} onClick={() => setConfirmLaunch(null)}>Cancel</Button>
              </div>
              {launchError && <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--t-xs)', marginTop: 6 }}>{launchError}</div>}
            </div>
          )}

          {result?.template.id === t.id && (
            <div data-testid="template-results" style={{ marginTop: 8, fontSize: 'var(--t-xs)' }}>
              <div className="setting-row-hint">
                {result.response.group ? `Started into group “${result.response.group.name}”.` : 'Nothing was started.'}
              </div>
              <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                {result.response.results.map((r) => (
                  <li key={r.index} data-testid={r.ok ? 'template-result-ok' : 'template-result-error'} style={{ color: r.ok ? 'var(--ok)' : 'var(--danger)' }}>
                    {r.ok
                      ? `✓ ${r.session.name}`
                      : `✗ ${t.specs[r.index] ? (t.specs[r.index]!.name ?? base(t.specs[r.index]!.folder)) : `#${r.index + 1}`}: ${r.error}`}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Dismiss</Button>
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}
