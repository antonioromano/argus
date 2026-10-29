import { AlertTriangle } from 'lucide-react';
import { Section, Segmented, Icon, Toggle } from '../../../../components/primitives/index.js';
import { TerminalChoice } from '../../../ui/TerminalChoice.js';
import { kindOf, settingsFor } from '../../../ui/terminalKind.js';
import { showNativeMessageBox } from '../../../../utils/nativeDialog.js';
import type { PaneProps } from '../types.js';
import { OrphanAgentsSection } from './OrphanAgentsSection.js';
import { SettingAnchor, SettingField } from '../SettingField.js';
import { BACKEND_OPTIONS, type Backend } from '../options.js';
import { SETTINGS_BY_ID, settingHint } from '../catalog.js';

/**
 * Where the process layer is chosen, plus what sits under the hood with it:
 * orphan-agent maintenance and the developer diagnostics (once its own pane).
 * Backend and default terminal are read at launch; the banner names those two
 * so it does not read as covering the sections below them.
 */
export function RuntimePane({ config, onSave }: PaneProps) {
  const backend: Backend = config.ptyBackend ?? 'auto';

  const changeBackend = async (target: Backend) => {
    if (target === backend) return;
    const choice = await showNativeMessageBox({
      type: 'question',
      message: target === 'auto' ? 'Switch to the argusd daemon backend?' : 'Switch to the legacy tmux backend?',
      detail:
        'Running sessions stay on their current backend. The switch applies to sessions hosted after the app restarts. '
        + 'Direct sessions stop on restart.',
      buttons: ['Cancel', 'Apply on next launch', 'Restart now'],
      defaultId: 2,
      cancelId: 0,
    }).catch(() => 0);
    if (choice === 0) return; // Cancel — Segmented is config-controlled, so it snaps back
    await onSave({ ptyBackend: target });
    if (choice === 2) window.electronApp?.relaunch();
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '9px 11px',
          marginBottom: 'var(--s-5)',
          borderRadius: 'var(--r-2)',
          background: 'var(--warn-bg)',
          border: '1px solid color-mix(in srgb, var(--warn) 44%, transparent)',
          fontSize: 'var(--t-xs)',
          lineHeight: 1.5,
        }}
      >
        <Icon icon={AlertTriangle} size={14} strokeWidth={1.8} color="var(--warn)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Backend and default terminal changes apply to shells hosted after the next app launch.
          Running shells keep the backend and engine they were created with.
        </span>
      </div>

      <Section title="Process backend">
        <SettingField id="ptyBackend">
          <Segmented
            label="Process backend"
            value={backend}
            options={BACKEND_OPTIONS}
            onChange={(v) => { void changeBackend(v); }}
          />
        </SettingField>
      </Section>

      <Section title="Default terminal">
        <SettingAnchor id="defaultTerminal">
          <div className="settings-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
            <TerminalChoice
              value={kindOf(config.defaultRunMode, config.defaultTerminalEngine)}
              onChange={(k) => {
                const next = settingsFor(k);
                onSave({ defaultRunMode: next.runMode, defaultTerminalEngine: next.terminalEngine });
              }}
            />
            <p style={{ margin: 0, fontSize: 'var(--t-xs)', color: 'var(--fg-3)', lineHeight: 1.5 }}>
              {settingHint(SETTINGS_BY_ID.defaultTerminal)}
            </p>
          </div>
        </SettingAnchor>
      </Section>

      <OrphanAgentsSection />

      <Section title="Diagnostics">
        <SettingField id="debugToolsEnabled">
          <Toggle checked={config.debugToolsEnabled ?? false} onChange={(v) => onSave({ debugToolsEnabled: v })} />
        </SettingField>
      </Section>
    </>
  );
}
