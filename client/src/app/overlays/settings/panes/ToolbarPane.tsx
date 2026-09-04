import { Section, SettingRow, Toggle } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

export function ToolbarPane({ config, onSave }: PaneProps) {
  const showClock = config.showClock ?? false;

  return (
    <Section title="Clock">
      <SettingRow label="Show clock in toolbar" hint="Displays current time (HH:MM) before the remote access icon">
        <Toggle checked={showClock} onChange={(v) => onSave({ showClock: v })} />
      </SettingRow>
      {showClock && (
        <SettingRow label="Show seconds" hint="Extends the clock to HH:MM:SS">
          <Toggle checked={config.clockShowSeconds ?? false} onChange={(v) => onSave({ clockShowSeconds: v })} />
        </SettingRow>
      )}
    </Section>
  );
}
