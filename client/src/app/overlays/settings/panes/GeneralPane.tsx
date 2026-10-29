import { useState } from 'react';
import { Section, Toggle, TextInput } from '../../../../components/primitives/index.js';
import { SettingField } from '../SettingField.js';
import type { PaneProps } from '../types.js';

/**
 * App-wide behaviour with no other home: what Argus asks before doing, what
 * Quit does, whether the Mac may sleep, and the name of the ungrouped bucket.
 * These were three panes (Confirmations, Power, Groups) holding one to four
 * toggles each.
 */
export function GeneralPane({ config, onSave }: PaneProps) {
  const exitOnQuit = config.exitSessionsOnQuit ?? false;

  return (
    <>
      <Section title="Ask before">
        <SettingField id="confirmCloseShell">
          <Toggle
            checked={config.confirmCloseShell !== false}
            onChange={(v) => onSave({ confirmCloseShell: v })}
          />
        </SettingField>
      </Section>

      <Section title="On Quit">
        <SettingField id="exitSessionsOnQuit">
          <Toggle checked={exitOnQuit} onChange={(v) => onSave({ exitSessionsOnQuit: v })} />
        </SettingField>
        {/* Only meaningful when the switch above is off: once it's on, ⌘Q
            already goes through the stop-all dialog (below) and terminates
            every session — direct included — so this toggle would have no
            effect on that path. */}
        {!exitOnQuit && (
          <SettingField id="confirmQuitDirectSessions">
            <Toggle
              checked={config.confirmQuitDirectSessions !== false}
              onChange={(v) => onSave({ confirmQuitDirectSessions: v })}
            />
          </SettingField>
        )}
        {/* Only meaningful while Quit actually terminates: with the switch above
            off, ⌘Q detaches and there is nothing to confirm. */}
        {exitOnQuit && (
          <SettingField id="confirmExitOnQuit">
            <Toggle
              checked={config.confirmExitOnQuit ?? true}
              onChange={(v) => onSave({ confirmExitOnQuit: v })}
            />
          </SettingField>
        )}
      </Section>

      <Section title="Sleep">
        <SettingField id="preventSleepWhileRunning">
          <Toggle
            checked={config.preventSleepWhileRunning ?? false}
            onChange={(v) => onSave({ preventSleepWhileRunning: v })}
          />
        </SettingField>
      </Section>

      <Section title="Naming">
        <OthersFolderName saved={config.othersFolderName ?? 'Others'} onSave={onSave} />
      </Section>
    </>
  );
}

function OthersFolderName({ saved, onSave }: { saved: string; onSave: PaneProps['onSave'] }) {
  // The field is a draft committed on blur, so it needs local state — but it must
  // follow the saved value when that moves under us (another window, a Reset all).
  // Reconciled during render rather than in an effect: no cascading re-render, and
  // the input never paints one frame of the stale name.
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setDraft(saved);
  }

  return (
    <SettingField id="othersFolderName">
      <TextInput
        value={draft}
        onChange={setDraft}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed.length >= 1) onSave({ othersFolderName: trimmed });
          else setDraft(saved);
        }}
      />
    </SettingField>
  );
}
