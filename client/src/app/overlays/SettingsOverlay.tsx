import { useMemo, useState } from 'react';
import type { AppConfig, AgentFlag, NgrokStatus, SessionInfo } from '@argus/shared';
import { Sheet, Button, AlertSheet } from '../../components/primitives/index.js';
import { SettingsNav } from './settings/SettingsNav.js';
import {
  PANES,
  PANES_BY_ID,
  modifiedKeys,
  modifiedPanes,
  paneMatches,
  resetPatch,
  resolvePaneId,
  RESETTABLE_KEYS,
  type PaneId,
} from './settings/registry.js';
import { ThemePane } from './settings/panes/ThemePane.js';
import { TypographyPane } from './settings/panes/TypographyPane.js';
import { ShellHeaderPane } from './settings/panes/ShellHeaderPane.js';
import { ToolbarPane } from './settings/panes/ToolbarPane.js';
import { AgentsPane } from './settings/panes/AgentsPane.js';
import { GroupsPane } from './settings/panes/GroupsPane.js';
import { IsolationPane } from './settings/panes/IsolationPane.js';
import { ConfirmationsPane } from './settings/panes/ConfirmationsPane.js';
import { NotificationsPane } from './settings/panes/NotificationsPane.js';
import { KeyboardPane } from './settings/panes/KeyboardPane.js';
import { RuntimePane } from './settings/panes/RuntimePane.js';
import { PowerPane } from './settings/panes/PowerPane.js';
import { RemotePane } from './settings/panes/RemotePane.js';
import { DeveloperPane } from './settings/panes/DeveloperPane.js';

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
}: SettingsOverlayProps) {
  const [pane, setPane] = useState<PaneId>(() => resolvePaneId(initialTab));
  const [query, setQuery] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const modified = useMemo(() => modifiedPanes(config), [config]);
  const changedCount = useMemo(() => modifiedKeys(config).size, [config]);
  const def = PANES_BY_ID[pane];

  // Typing in the filter jumps to the first match when the open pane is filtered
  // out — otherwise the list narrows to results the content pane contradicts.
  const handleQuery = (next: string) => {
    setQuery(next);
    if (!next.trim()) return;
    const matches = PANES.filter((p) => paneMatches(p, next));
    if (matches.length > 0 && !matches.some((p) => p.id === pane)) setPane(matches[0].id);
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
          />

          <main
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

              {pane === 'theme' && <ThemePane {...paneProps} />}
              {pane === 'typography' && <TypographyPane {...paneProps} />}
              {pane === 'shell-header' && <ShellHeaderPane {...paneProps} />}
              {pane === 'toolbar' && <ToolbarPane {...paneProps} />}
              {pane === 'agents' && (
                <AgentsPane {...paneProps} onSaveFlag={onSaveFlag} onDeleteFlag={onDeleteFlag} />
              )}
              {pane === 'groups' && <GroupsPane {...paneProps} />}
              {pane === 'isolation' && <IsolationPane sessions={sessions} />}
              {pane === 'confirmations' && <ConfirmationsPane {...paneProps} />}
              {pane === 'notifications' && <NotificationsPane {...paneProps} />}
              {pane === 'keyboard' && <KeyboardPane {...paneProps} />}
              {pane === 'runtime' && <RuntimePane {...paneProps} />}
              {pane === 'power' && <PowerPane {...paneProps} />}
              {pane === 'remote' && (
                <RemotePane
                  ngrokStatus={ngrokStatus}
                  ngrokLoading={ngrokLoading}
                  ngrokError={ngrokError}
                  onNgrokStart={onNgrokStart}
                  onNgrokStop={onNgrokStop}
                />
              )}
              {pane === 'developer' && <DeveloperPane {...paneProps} />}
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
