import { Section, SettingRow, Toggle } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

/**
 * Every "are you sure?" in one place. These three used to live apart —
 * confirmCloseShell under the Keyboard tab, the two quit prefs under
 * General → Sessions — so no screen answered "what will Argus ask me about?".
 */
export function ConfirmationsPane({ config, onSave }: PaneProps) {
  const exitOnQuit = config.exitSessionsOnQuit ?? false;

  return (
    <>
      <Section title="Ask before">
        <SettingRow
          label="Closing a shell"
          hint="Show a confirmation when closing a shell with ⌘W or the close button"
        >
          <Toggle
            checked={config.confirmCloseShell !== false}
            onChange={(v) => onSave({ confirmCloseShell: v })}
          />
        </SettingRow>
      </Section>

      <Section title="On Quit">
        <SettingRow
          label="Exit all sessions on Quit"
          hint="When off, ⌘Q keeps sessions running in the background. When on, ⌘Q terminates every session."
        >
          <Toggle checked={exitOnQuit} onChange={(v) => onSave({ exitSessionsOnQuit: v })} />
        </SettingRow>
        {/* Only meaningful while Quit actually terminates: with the switch above
            off, ⌘Q detaches and there is nothing to confirm. */}
        {exitOnQuit && (
          <SettingRow
            label="Confirm before exiting"
            hint="Show a confirmation dialog listing running sessions before ⌘Q terminates them"
          >
            <Toggle
              checked={config.confirmExitOnQuit ?? true}
              onChange={(v) => onSave({ confirmExitOnQuit: v })}
            />
          </SettingRow>
        )}
      </Section>
    </>
  );
}
