import type { MosaicOrientation, MosaicWaitingStyle } from '@argus/shared';
import { Section, SettingRow, Segmented } from '../../../../components/primitives/index.js';
import { useTheme } from '../../../../context/theme-context.js';
import type { ThemeMode } from '../../../../context/theme-context.js';
import { WaitingStylePreview } from '../../../ui/WaitingStylePreview.js';
import type { PaneProps } from '../types.js';

const THEME_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const LAYOUT_OPTIONS: readonly { value: MosaicOrientation; label: string }[] = [
  { value: 'horizontal', label: 'Side by side' },
  { value: 'vertical', label: 'Stacked' },
];

const WAITING_OPTIONS: readonly { value: MosaicWaitingStyle; label: string }[] = [
  { value: 'breathing', label: 'Breathing halo' },
  { value: 'flag', label: 'Pulse bar + flag' },
];

export function ThemePane({ config, onSave }: PaneProps) {
  const { mode, setMode } = useTheme();

  return (
    <>
      <Section title="Theme">
        <SettingRow label="Appearance" hint="Match the system or pick a fixed appearance">
          <Segmented label="Theme" value={mode} options={THEME_OPTIONS} onChange={setMode} />
        </SettingRow>
      </Section>

      <Section title="Shell layout">
        <SettingRow label="Arrangement" hint="Arrange mosaic shells side by side or stacked one under another">
          <Segmented
            label="Shell layout"
            value={config.mosaicOrientation ?? 'horizontal'}
            options={LAYOUT_OPTIONS}
            onChange={(mosaicOrientation) => { void onSave({ mosaicOrientation }); }}
          />
        </SettingRow>
      </Section>

      <Section title="Waiting attention">
        <SettingRow label="Style" hint="How a shell waiting for input stands out in the mosaic">
          <Segmented
            label="Waiting attention style"
            value={config.mosaicWaitingStyle ?? 'breathing'}
            options={WAITING_OPTIONS}
            onChange={(mosaicWaitingStyle) => { void onSave({ mosaicWaitingStyle }); }}
          />
        </SettingRow>
        {/* "Breathing halo" vs "Pulse bar + flag" is unreadable as text — the
            difference is the motion, so show it moving. */}
        <SettingRow label="Preview" hint="A waiting shell in the mosaic, animating">
          <WaitingStylePreview style={config.mosaicWaitingStyle ?? 'breathing'} />
        </SettingRow>
      </Section>
    </>
  );
}
