import { Section, SettingRow, Toggle } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

export function PowerPane({ config, onSave }: PaneProps) {
  return (
    <Section title="Sleep">
      <SettingRow
        label="Keep Mac awake while running"
        hint="Prevents macOS from sleeping while at least one shell is running"
      >
        <Toggle
          checked={config.preventSleepWhileRunning ?? false}
          onChange={(v) => onSave({ preventSleepWhileRunning: v })}
        />
      </SettingRow>
    </Section>
  );
}
