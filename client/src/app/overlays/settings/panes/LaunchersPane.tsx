import { useCallback, useEffect, useRef, useState } from 'react';
import type { Launcher } from '@argus/shared';
import { Button, Section, SettingRow, pushToast } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

/** The deep-link scheme main registered (argus / argus-dev); main is the source of truth. */
const scheme = () => window.electronLaunch?.scheme || 'argus';
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EXAMPLE = () => `${scheme()}://new?agent=claude&folder=~/development/my-repo&prompt=hello`;

export function LaunchersPane({ config, onSave }: PaneProps) {
  const bridge = window.electronLaunch?.launchers;
  const [list, setList] = useState<Launcher[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const configRoots = (config.launchFolderRoots ?? []).join('\n');
  const [roots, setRoots] = useState(configRoots);
  const rootsFocused = useRef(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const refresh = useCallback(() => {
    bridge?.list().then((l) => { setLoadError(null); setList(l); }, (e: unknown) => setLoadError(errMsg(e)));
  }, [bridge]);
  useEffect(() => { refresh(); }, [refresh]);
  // Follow external config changes (footer Reset, another window) unless the user is typing.
  useEffect(() => { if (!rootsFocused.current) setRoots(configRoots); }, [configRoots]);

  const remove = async (l: Launcher) => {
    setConfirming(null);
    try {
      const r = await bridge!.remove(l.id);
      if (!r.ok) { pushToast(r.error, 'danger'); return; }
    } catch (e) { pushToast(errMsg(e), 'danger'); return; }
    pushToast(`Deleted ${l.label}`, 'ok');
    refresh();
  };
  // Inline edit: Electron does not implement window.prompt().
  const saveRename = async () => {
    if (!editing || !editing.draft.trim()) return;
    try {
      const r = await bridge!.rename(editing.id, editing.draft);
      if (!r.ok) { pushToast(r.error, 'danger'); return; }
    } catch (e) { pushToast(errMsg(e), 'danger'); return; }
    setEditing(null);
    refresh();
  };
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => pushToast('Link copied', 'ok'), (e: unknown) => pushToast(errMsg(e), 'danger'));
  };
  const saveRoots = async () => {
    rootsFocused.current = false;
    const next = roots.split('\n').map((r) => r.trim()).filter(Boolean);
    if (next.join('\n') === configRoots) { setRoots(configRoots); return; }
    try { await onSave({ launchFolderRoots: next }); } catch (e) { pushToast(errMsg(e), 'danger'); }
  };

  return (
    <>
      <Section title="Launchers">
        {!bridge && <div className="setting-row"><div className="setting-row-hint">Launchers are available in the desktop app.</div></div>}
        {bridge && list?.length === 0 && (
          <div className="setting-row"><div className="setting-row-hint">No launchers. Approve a launch link and choose Save as launcher.</div></div>
        )}
        {bridge && loadError && (
          <div className="setting-row" data-testid="launchers-error"><div className="setting-row-hint">Could not load launchers: {loadError}</div></div>
        )}
        {list?.map((l) => (
          <div key={l.id} className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing?.id === l.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input data-testid="launcher-rename-input" value={editing.draft} onChange={(e) => setEditing({ id: l.id, draft: e.target.value })} aria-label="Launcher label" />
                    <span data-testid="launcher-rename-save" onClick={() => void saveRename()}><Button size="sm" disabled={!editing.draft.trim()}>Save</Button></span>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="setting-row-label">{l.label}</div>
                )}
                <div className="setting-row-hint mono">{scheme()}://run/{l.id}</div>
                <div className="setting-row-hint">{l.request.agent} @ {base(l.request.folder)} · {new Date(l.createdAt).toLocaleDateString()}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copy(`${scheme()}://run/${l.id}`)}>Copy link</Button>
              <span data-testid="launcher-rename" onClick={() => setEditing({ id: l.id, draft: l.label })}><Button size="sm" variant="ghost">Rename</Button></span>
              {confirming === l.id ? (
                <>
                  <span className="setting-row-hint">Delete {l.label}?</span>
                  <span data-testid="launcher-delete-confirm" onClick={() => void remove(l)}><Button size="sm" variant="ghost" danger>Confirm</Button></span>
                  <span data-testid="launcher-delete-cancel" onClick={() => setConfirming(null)}><Button size="sm" variant="ghost">Cancel</Button></span>
                </>
              ) : (
                <span data-testid="launcher-delete" onClick={() => setConfirming(l.id)}><Button size="sm" variant="ghost" danger>Delete</Button></span>
              )}
              <span data-testid="launcher-expand" onClick={() => setOpen(open === l.id ? null : l.id)}><Button size="sm" variant="ghost">{open === l.id ? 'Hide' : 'Details'}</Button></span>
            </div>
            {open === l.id && (
              <div className="mono" style={{ fontSize: 'var(--t-xs)', marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <div>folder: {l.request.folder}</div>
                <div>command: {l.agentCommand}</div>
                {l.request.flags.map((f, i) => <div key={i}>arg: {f}</div>)}
                {l.request.prompt !== undefined && <div>prompt: {l.request.prompt}</div>}
              </div>
            )}
          </div>
        ))}
      </Section>
      <Section title="Launch links">
        <SettingRow label="Folder roots" hint="One per line. Links to folders outside these get a warning on the approval card (never blocked).">
          <textarea
            data-testid="launch-roots"
            className="mono"
            rows={3}
            value={roots}
            onChange={(e) => setRoots(e.target.value)}
            onFocus={() => { rootsFocused.current = true; }}
            onBlur={() => void saveRoots()}
          />
        </SettingRow>
        <SettingRow label="Link format" hint="Every argus://new link opens an approval card.">
          <Button size="sm" variant="ghost" onClick={() => copy(EXAMPLE())}>Copy example link</Button>
        </SettingRow>
      </Section>
    </>
  );
}
