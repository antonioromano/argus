import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, AgentFlag, NgrokStatus, SessionInfo } from '@argus/shared';
import { Sheet, Button, AlertSheet } from '../../components/primitives/index.js';
import { SettingsNav } from './settings/SettingsNav.js';
import {
  PANES_BY_ID,
  modifiedKeys,
  modifiedPanes,
  resetPatch,
  resolvePaneId,
  RESETTABLE_KEYS,
  type PaneId,
} from './settings/registry.js';
import { jumpTarget, searchSettings, visiblePanes } from './settings/search.js';
import { SettingTargetContext } from './settings/settingTarget.js';
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
  /** Pane to open on mount. Accepts the pre-0.24 tab ids too (see resolvePaneId). */
  initialTab?: string;
  /** Catalog id of a setting to open at: its pane opens and its row is scrolled
   *  to and flashed. Wins over `initialTab`; an unknown id falls back to it. */
  focusSetting?: string;
}

/**
 * The settings shell: sidebar, one pane, and a footer that accounts for what has
 * been changed. It owns navigation and nothing else — every pane reads `config`
 * and writes through `onSave`, so no settings state lives here.
 */
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
}: SettingsOverlayProps) {
  // Resolved once, on mount: where a deep link lands (the parent toggle while
  // the setting itself is hidden).
  const [initialTarget] = useState(() => (focusSetting ? jumpTarget(focusSetting, config) : undefined));
  const [pane, setPane] = useState<PaneId>(() => initialTarget?.pane ?? resolvePaneId(initialTab));
  const [query, setQuery] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  /** Row being flashed after a jump; `seq` re-triggers the scroll for a repeat jump. */
  const [target, setTarget] = useState<{ id: string; seq: number } | null>(
    () => (initialTarget ? { id: initialTarget.id, seq: 0 } : null),
  );
  const mainRef = useRef<HTMLElement>(null);

  const modified = useMemo(() => modifiedPanes(config), [config]);
  const changedCount = useMemo(() => modifiedKeys(config).size, [config]);
  const hits = useMemo(() => searchSettings(query, config), [query, config]);
  const def = PANES_BY_ID[pane];

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

  const doReset = async () => {
    setResetting(true);
    try {
      await onSave(resetPatch());
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  };

  const paneProps = { config, onSave };

  const renderPane = () => {
    switch (pane) {
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
              {changedCount === 0
                ? 'ALL SETTINGS AT DEFAULTS'
                : `${changedCount} SETTING${changedCount === 1 ? '' : 'S'} CHANGED FROM DEFAULTS`}
            </span>
            <Button variant="ghost" disabled={changedCount === 0} onClick={() => setConfirmReset(true)}>
              Reset all…
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
          />

          <main
            ref={mainRef}
            className="argus-scroll"
            style={{ flex: 1, overflow: 'auto', padding: 'var(--s-6) var(--s-7)' }}
          >
            {/* Fixed width across every pane: the old per-tab maxWidth (720/580/520)
                made content jump sideways on each tab switch. */}
            <div style={{ width: 640, maxWidth: '100%' }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>{def.group}</div>
              <h2 style={{
                fontSize: 'var(--t-2xl)',
                margin: '6px 0 var(--s-5)',
                letterSpacing: 'var(--tracking-tight)',
                fontWeight: 600,
              }}>
                {def.label}
              </h2>

              <SettingTargetContext.Provider value={target?.id ?? null}>
                {renderPane()}
              </SettingTargetContext.Provider>
            </div>
          </main>
        </div>
      </Sheet>

      <AlertSheet
        isOpen={confirmReset}
        title="Reset all settings?"
        message={
          `Every preference goes back to its shipped default (${RESETTABLE_KEYS.length} in total), `
          + 'including your keyboard shortcuts.\n\n'
          + 'Your custom agents and their saved flags are left alone, and no session is touched.'
        }
        confirmLabel="Reset all settings"
        confirmDestructive
        confirmLoading={resetting}
        onConfirm={() => void doReset()}
        onCancel={() => setConfirmReset(false)}
      />
    </>
  );
}
