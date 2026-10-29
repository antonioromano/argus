import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, AgentFlag, NgrokStatus, SessionInfo } from '@argus/shared';
import { Sheet, Button } from '../../components/primitives/index.js';
import { SettingsNav } from './settings/SettingsNav.js';
import {
  PANES_BY_ID,
  modifiedKeys,
  modifiedPanes,
  modifiedSettings,
  paneResetKeys,
  paneResetPatch,
  resetPatch,
  settingResetPatch,
  resolvePaneId,
  type PaneId,
} from './settings/registry.js';
import { jumpTarget, searchSettings, visiblePanes } from './settings/search.js';
import { SettingTargetContext } from './settings/settingTarget.js';
import type { SettingDescriptor } from './settings/catalog.js';
import { useSettingsTransfer } from './settings/useSettingsTransfer.js';
import { offerUndo, UNDO_WINDOW_LONG_MS } from '../../utils/undoable.js';
import { toastError } from '../../errors/toastError.js';
import { snapshotKeys } from '../../utils/configSnapshot.js';
import { ModifiedPane } from './settings/panes/ModifiedPane.js';
import { ThemePane } from './settings/panes/ThemePane.js';
import { ShellHeaderPane } from './settings/panes/ShellHeaderPane.js';
import { AgentsPane } from './settings/panes/AgentsPane.js';
import { IsolationPane } from './settings/panes/IsolationPane.js';
import { LaunchersPane } from './settings/panes/LaunchersPane.js';
import { GeneralPane } from './settings/panes/GeneralPane.js';
import { AutoApprovalPane } from './settings/panes/AutoApprovalPane.js';
import { NotificationsPane } from './settings/panes/NotificationsPane.js';
import { KeyboardPane } from './settings/panes/KeyboardPane.js';
import { RuntimePane } from './settings/panes/RuntimePane.js';
import { RemotePane } from './settings/panes/RemotePane.js';
import { BetaPane } from './settings/panes/BetaPane.js';

/** How long a jumped-to row keeps its highlight (matches the CSS keyframe). */
const FLASH_MS = 1600;

interface SettingsOverlayProps {
  config: AppConfig;
  sessions?: SessionInfo[];
  onClose: () => void;
  onSave: (data: Partial<AppConfig>) => Promise<AppConfig>;
  onSaveFlag: (agentId: string, flag: AgentFlag) => Promise<void>;
  onDeleteFlag: (agentId: string, flagId: string) => Promise<void>;
  ngrokStatus: NgrokStatus | null;
  ngrokLoading: boolean;
  ngrokError: string | null;
  onNgrokStart: (password: string) => void;
  onNgrokStop: () => void;
  /** Pane to open on mount. Accepts the pre-0.24 tab ids too (see resolvePaneId),
   *  and `'modified'` for the Modified view. */
  initialTab?: string;
  /** Catalog id of a setting to open at: its pane opens and its row is scrolled
   *  to and flashed. Wins over `initialTab`; an unknown id falls back to it. */
  focusSetting?: string;
  /** Run Export or Import (the app menu, the palette). A new object each time,
   *  so asking twice runs twice while the sheet stays open. */
  action?: { kind: 'export' | 'import' };
}

/** The open pane, or the virtual cross-pane Modified view. */
type View = PaneId | 'modified';

/**
 * The settings shell: sidebar, one pane, and a footer that accounts for what has
 * been changed. It owns navigation and nothing else — every pane reads `config`
 * and writes through `onSave`, so no settings state lives here.
 */
const LAST_PANE_KEY = 'argus.settingsPane';

function loadLastPane(): string | undefined {
  try {
    return localStorage.getItem(LAST_PANE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveLastPane(id: string): void {
  try {
    localStorage.setItem(LAST_PANE_KEY, id);
  } catch {
    /* best effort */
  }
}

export function SettingsOverlay({
  config,
  sessions = [],
  onClose,
  onSave,
  onSaveFlag,
  onDeleteFlag,
  ngrokStatus,
  ngrokLoading,
  ngrokError,
  onNgrokStart,
  onNgrokStop,
  initialTab,
  focusSetting,
  action,
}: SettingsOverlayProps) {
  // Resolved once, on mount: where a deep link lands (the parent toggle while
  // the setting itself is hidden).
  const [initialTarget] = useState(() => (focusSetting ? jumpTarget(focusSetting, config) : undefined));
  // An explicit tab or deep link wins; otherwise reopen on the last pane shown.
  const [pane, setPane] = useState<View>(
    () => initialTarget?.pane ?? (initialTab === 'modified' ? 'modified' : resolvePaneId(initialTab ?? loadLastPane())),
  );
  useEffect(() => {
    if (pane !== 'modified') saveLastPane(pane);
  }, [pane]);
  const [query, setQuery] = useState('');
  /** Row being flashed after a jump; `seq` re-triggers the scroll for a repeat jump. */
  const [target, setTarget] = useState<{ id: string; seq: number } | null>(
    () => (initialTarget ? { id: initialTarget.id, seq: 0 } : null),
  );
  const mainRef = useRef<HTMLElement>(null);

  const modified = useMemo(() => modifiedPanes(config), [config]);
  const changedCount = useMemo(() => modifiedKeys(config).size, [config]);
  const hits = useMemo(() => searchSettings(query, config), [query, config]);
  const modifiedCount = useMemo(() => modifiedSettings(config).length, [config]);
  const def = pane === 'modified' ? null : PANES_BY_ID[pane];
  const paneResettable = def ? paneResetKeys(def.id, config) : [];
  const transfer = useSettingsTransfer(config, onSave);

  // Menu / palette asked for Export or Import while Settings is open (or opening).
  const { exportSettings, importSettings } = transfer;
  useEffect(() => {
    if (action?.kind === 'export') void exportSettings();
    else if (action?.kind === 'import') void importSettings();
    // Only a new request runs; the handlers change with config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  /** Open the pane holding setting `id`, scroll its row into view and flash it.
   *  A hidden setting lands on the toggle that reveals it. */
  const goTo = useCallback((id: string) => {
    const dest = jumpTarget(id, config);
    if (!dest) return;
    setPane(dest.pane);
    setTarget((prev) => ({ id: dest.id, seq: (prev?.seq ?? 0) + 1 }));
  }, [config]);

  // After the pane holding the target has committed, scroll on the next frame
  // (the row may only exist from this render), then drop the flash.
  useEffect(() => {
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      // Catalog ids are [\w:-] only, so the quoted attribute selector is safe.
      const el = mainRef.current?.querySelector(`[data-setting-id="${target.id}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const done = setTimeout(() => setTarget(null), FLASH_MS);
    return () => { cancelAnimationFrame(frame); clearTimeout(done); };
  }, [target]);

  // Typing in the filter jumps to the top hit's pane when the open pane is
  // filtered out — otherwise the list narrows to results the content pane
  // contradicts.
  const handleQuery = (next: string) => {
    setQuery(next);
    if (!next.trim()) return;
    const nextHits = searchSettings(next, config);
    const matches = visiblePanes(next, nextHits);
    if (matches.length === 0 || matches.some((p) => p.id === pane)) return;
    setPane(nextHits[0]?.setting.pane ?? matches[0].id);
  };

  /** Reversible, so no confirm: write the defaults, offer Undo from a snapshot
   *  (docs/design/feedback-surfaces.md). */
  const resetWithUndo = (patch: Partial<AppConfig>, message: string, durationMs?: number) => {
    const keys = Object.keys(patch) as (keyof AppConfig)[];
    if (keys.length === 0) return;
    const before = snapshotKeys(config, keys);
    void onSave(patch).then(
      () => { offerUndo({ message, durationMs, undo: async () => { await onSave(before); } }); },
      (err: unknown) => { toastError(err, 'Couldn’t reset'); },
    );
  };
  const resetPane = () => {
    if (def) resetWithUndo(paneResetPatch(def.id, config), `Reset ${def.label}`);
  };
  const resetSetting = (s: SettingDescriptor) => resetWithUndo(settingResetPatch(s, config), `Reset ${s.label}`);

  // Reset all is exactly reversible too (a snapshot of every key it writes,
  // shortcuts included), so it gets the long Undo window instead of a sheet.
  const resetAll = () => resetWithUndo(resetPatch(), 'Reset all settings', UNDO_WINDOW_LONG_MS);

  const paneProps = { config, onSave };

  const renderPane = () => {
    switch (pane) {
      case 'modified': return <ModifiedPane config={config} onReset={resetSetting} onGoTo={goTo} />;
      case 'theme': return <ThemePane {...paneProps} />;
      case 'shell-header': return <ShellHeaderPane {...paneProps} />;
      case 'agents': return <AgentsPane {...paneProps} onSaveFlag={onSaveFlag} onDeleteFlag={onDeleteFlag} />;
      case 'isolation': return <IsolationPane sessions={sessions} />;
      case 'launchers': return <LaunchersPane {...paneProps} />;
      case 'general': return <GeneralPane {...paneProps} />;
      case 'auto-approval': return <AutoApprovalPane {...paneProps} />;
      case 'notifications': return <NotificationsPane {...paneProps} />;
      case 'keyboard': return <KeyboardPane {...paneProps} />;
      case 'runtime': return <RuntimePane {...paneProps} />;
      case 'remote':
        return (
          <RemotePane
            ngrokStatus={ngrokStatus}
            ngrokLoading={ngrokLoading}
            ngrokError={ngrokError}
            onNgrokStart={onNgrokStart}
            onNgrokStop={onNgrokStop}
          />
        );
      case 'beta': return <BetaPane {...paneProps} />;
    }
  };

  return (
    <>
      <Sheet
        eyebrow="ARGUS"
        title="Settings"
        width={920}
        onClose={onClose}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%' }}>
            <span className="eyebrow" style={{ flex: 1 }}>
              {changedCount === 0 ? 'ALL SETTINGS AT DEFAULTS' : (
                <button
                  type="button"
                  onClick={() => setPane('modified')}
                  title="Show every modified setting"
                  style={{
                    background: 'none', border: 0, padding: 0, font: 'inherit', letterSpacing: 'inherit',
                    color: 'var(--accent)', cursor: 'pointer',
                  }}
                >
                  {`${changedCount} SETTING${changedCount === 1 ? '' : 'S'} CHANGED FROM DEFAULTS`}
                </button>
              )}
            </span>
            {transfer.available && (
              <>
                <Button variant="ghost" onClick={() => void transfer.exportSettings()}>Export…</Button>
                <Button variant="ghost" onClick={() => void transfer.importSettings()}>Import…</Button>
              </>
            )}
            <Button variant="ghost" disabled={changedCount === 0} onClick={resetAll}>
              Reset all
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', height: 560, margin: 'calc(-1 * var(--s-5)) calc(-1 * var(--s-6))' }}>
          <SettingsNav
            active={pane}
            onSelect={setPane}
            modified={modified}
            query={query}
            onQuery={handleQuery}
            hits={hits}
            onGoTo={goTo}
            modifiedCount={modifiedCount}
            onShowModified={() => setPane('modified')}
          />

          <main
            ref={mainRef}
            className="argus-scroll"
            style={{ flex: 1, overflow: 'auto', padding: 'var(--s-6) var(--s-7)' }}
          >
            {/* Fixed width across every pane: the old per-tab maxWidth (720/580/520)
                made content jump sideways on each tab switch. */}
            <div style={{ width: 640, maxWidth: '100%' }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>{def ? def.group : 'Overview'}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-3)', margin: 'var(--s-1-5) 0 var(--s-5)' }}>
                <h2 style={{
                  flex: 1,
                  fontSize: 'var(--t-2xl)',
                  margin: 0,
                  letterSpacing: 'var(--tracking-tight)',
                  fontWeight: 600,
                }}>
                  {def ? def.label : 'Modified'}
                </h2>
                {def && def.keys.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={paneResettable.length === 0}
                    title={paneResettable.length === 0 ? 'Everything here is at its default' : `Reset ${def.label} to its defaults`}
                    onClick={resetPane}
                  >
                    Reset pane
                  </Button>
                )}
              </div>

              <SettingTargetContext.Provider value={target?.id ?? null}>
                {renderPane()}
              </SettingTargetContext.Provider>
            </div>
          </main>
        </div>
      </Sheet>

      {transfer.sheet}
    </>
  );
}
