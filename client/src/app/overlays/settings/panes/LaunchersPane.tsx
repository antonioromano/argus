import { useCallback, useEffect, useState } from 'react';
import type { Launcher } from '@argus/shared';
import { Button, Section, SettingRow, pushToast } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

const scheme = () => (import.meta.env.DEV ? 'argus-dev' : 'argus');
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const EXAMPLE = () => `${scheme()}://new?agent=claude&folder=~/development/my-repo&prompt=hello`;

export function LaunchersPane({ config, onSave }: PaneProps) {
  const bridge = window.electronLaunch?.launchers;
  const [list, setList] = useState<Launcher[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [roots, setRoots] = useState((config.launchFolderRoots ?? []).join('\n'));
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const refresh = useCallback(() => { void bridge?.list().then(setList); }, [bridge]);
  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (l: Launcher) => {
    const r = await bridge!.remove(l.id);
    if (!r.ok) { pushToast(r.error, 'danger'); return; }
    pushToast(`Deleted ${l.label}`, 'ok');
    refresh();
  };
  // Inline edit: Electron does not implement window.prompt().
  const saveRename = async () => {
    if (!editing) return;
    const r = await bridge!.rename(editing.id, editing.draft);
    if (!r.ok) { pushToast(r.error, 'danger'); return; }
    setEditing(null);
    refresh();
  };
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => pushToast('Link copied', 'ok')); };

  return (
    <>
      <Section title="Launchers">
        {!bridge && <div className="setting-row"><div className="setting-row-hint">Launchers are available in the desktop app.</div></div>}
        {bridge && list?.length === 0 && (
          <div className="setting-row"><div className="setting-row-hint">No launchers. Approve a launch link and choose Save as launcher.</div></div>
        )}
        {list?.map((l) => (
          <div key={l.id} className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing?.id === l.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input data-testid="launcher-rename-input" value={editing.draft} onChange={(e) => setEditing({ id: l.id, draft: e.target.value })} aria-label="Launcher label" />
                    <span data-testid="launcher-rename-save" onClick={() => void saveRename()}><Button size="sm">Save</Button></span>
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
              <span data-testid="launcher-delete" onClick={() => void remove(l)}><Button size="sm" variant="ghost" danger>Delete</Button></span>
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
            onBlur={() => void onSave({ launchFolderRoots: roots.split('\n').map((r) => r.trim()).filter(Boolean) })}
          />
        </SettingRow>
        <SettingRow label="Link format" hint="Every argus://new link opens an approval card.">
          <Button size="sm" variant="ghost" onClick={() => copy(EXAMPLE())}>Copy example link</Button>
        </SettingRow>
      </Section>
    </>
  );
}
