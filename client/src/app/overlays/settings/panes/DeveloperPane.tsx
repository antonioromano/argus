import { Section, SettingRow, Toggle } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

export function DeveloperPane({ config, onSave }: PaneProps) {
  return (
    <Section title="Diagnostics">
      <SettingRow
        label="Enable developer tools"
        hint="Adds a per-session diagnostics dump button (writes session state + output to ~/.argus/diagnostics for debugging)"
      >
        <Toggle checked={config.debugToolsEnabled ?? false} onChange={(v) => onSave({ debugToolsEnabled: v })} />
      </SettingRow>
    </Section>
  );
}
