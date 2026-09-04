import { AlertTriangle } from 'lucide-react';
import { Section, SettingRow, Segmented } from '../../../../components/primitives/index.js';
import { EngineChoice } from '../../../ui/EngineChoice.js';
import { ENGINE_NOTE_DEFAULT } from '../../../ui/terminalEngineCopy.js';
import { showNativeMessageBox } from '../../../../utils/nativeDialog.js';
import type { PaneProps } from '../types.js';

type Backend = 'auto' | 'tmux';

const BACKEND_OPTIONS: readonly { value: Backend; label: string; title: string }[] = [
  { value: 'auto', label: 'argusd', title: 'The Argus daemon — sessions survive app quit without tmux' },
  { value: 'tmux', label: 'tmux', title: 'The legacy backend — sessions live in a tmux server' },
];

/**
 * Where the process layer is chosen. Both settings here used to sit in
 * General → "Sessions", which described neither: they pick how a pty is hosted
 * and how a tile is drawn. Both are read at launch, so the deferral applies to
 * the whole pane — hence one banner at the top instead of a note buried in a row.
 */
export function RuntimePane({ config, onSave }: PaneProps) {
  const backend: Backend = config.ptyBackend ?? 'auto';

  const changeBackend = async (target: Backend) => {
    if (target === backend) return;
    const choice = await showNativeMessageBox({
      type: 'question',
      message: target === 'auto' ? 'Switch to the argusd daemon backend?' : 'Switch to the legacy tmux backend?',
      detail:
        'Running sessions stay on their current backend. The switch applies to sessions hosted after the app restarts.',
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
        <AlertTriangle size={14} strokeWidth={1.8} color="var(--warn)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Runtime changes apply to shells hosted after the next app launch. Running shells keep the
          backend and engine they were created with.
        </span>
      </div>

      <Section title="Process backend">
        <SettingRow
          label="Backend"
          hint="argusd survives app quit without tmux. tmux is the legacy path."
        >
          <Segmented
            label="Process backend"
            value={backend}
            options={BACKEND_OPTIONS}
            onChange={(v) => { void changeBackend(v); }}
          />
        </SettingRow>
      </Section>

      <Section title="Terminal engine">
        <div className="settings-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
          <EngineChoice
            value={config.defaultTerminalEngine ?? 'web'}
            onChange={(v) => onSave({ defaultTerminalEngine: v })}
          />
          <p style={{ margin: 0, fontSize: 'var(--t-xs)', color: 'var(--fg-3)', lineHeight: 1.5 }}>
            {ENGINE_NOTE_DEFAULT}
          </p>
        </div>
      </Section>
    </>
  );
}
