import { Section, SettingRow, Segmented, Toggle } from '../../../../components/primitives/index.js';
import { useTheme } from '../../../../context/theme-context.js';
import { WaitingStylePreview } from '../../../ui/WaitingStylePreview.js';
import { SettingField } from '../SettingField.js';
import {
  CODE_FONT_PRESETS,
  DENSITY_OPTIONS,
  DEFAULT_CODE_FONT_PX,
  DEFAULT_UI_FONT_PX,
  LAYOUT_OPTIONS,
  THEME_OPTIONS,
  UI_FONT_PRESETS,
  WAITING_OPTIONS,
  fontPreset,
} from '../options.js';
import type { PaneProps } from '../types.js';

/**
 * How Argus looks: theme and window material, density, font sizes, mosaic
 * layout, the waiting cue and the status bar (with its clock). Typography and Toolbar were their own panes (two keys each);
 * they are the same subject, and together still fit a screen.
 */
export function ThemePane({ config, onSave }: PaneProps) {
  const { mode, setMode } = useTheme();
  const showClock = config.showClock ?? false;

  return (
    <>
      <Section title="Theme">
        <SettingField id="device:themeMode">
          <Segmented label="Theme" value={mode} options={THEME_OPTIONS} onChange={setMode} />
        </SettingField>
      </Section>

      <Section title="Density">
        <SettingField id="density">
          <Segmented
            label="Density"
            value={config.density ?? 'default'}
            options={DENSITY_OPTIONS}
            onChange={(density) => { void onSave({ density }); }}
          />
        </SettingField>
      </Section>

      <Section title="Font sizes">
        <SettingField id="codeFontSize">
          <Segmented
            label="Code font size"
            compact
            value={fontPreset(CODE_FONT_PRESETS, config.codeFontSize, DEFAULT_CODE_FONT_PX)}
            options={CODE_FONT_PRESETS}
            onChange={(px) => { void onSave({ codeFontSize: Number(px) }); }}
          />
        </SettingField>
        <SettingField id="uiFontSize">
          <Segmented
            label="Interface font size"
            compact
            value={fontPreset(UI_FONT_PRESETS, config.uiFontSize, DEFAULT_UI_FONT_PX)}
            options={UI_FONT_PRESETS}
            onChange={(px) => { void onSave({ uiFontSize: Number(px) }); }}
          />
        </SettingField>
      </Section>

      <Section title="Session layout">
        <SettingField id="mosaicOrientation">
          <Segmented
            label="Session layout"
            value={config.mosaicOrientation ?? 'horizontal'}
            options={LAYOUT_OPTIONS}
            onChange={(mosaicOrientation) => { void onSave({ mosaicOrientation }); }}
          />
        </SettingField>
      </Section>

      <Section title="Waiting attention">
        <SettingField id="mosaicWaitingStyle">
          <Segmented
            label="Waiting attention style"
            value={config.mosaicWaitingStyle ?? 'breathing'}
            options={WAITING_OPTIONS}
            onChange={(mosaicWaitingStyle) => { void onSave({ mosaicWaitingStyle }); }}
          />
        </SettingField>
        {/* "Breathing halo" vs "Pulse bar + flag" is unreadable as text — the
            difference is the motion, so show it moving. */}
        <SettingRow label="Preview" hint="A waiting session in the mosaic, animating">
          <WaitingStylePreview style={config.mosaicWaitingStyle ?? 'breathing'} />
        </SettingRow>
      </Section>

      <Section title="Status bar">
        <SettingField id="showStatusBar">
          <Toggle checked={config.showStatusBar ?? true} onChange={(v) => onSave({ showStatusBar: v })} />
        </SettingField>
        <SettingField id="showClock">
          <Toggle checked={showClock} onChange={(v) => onSave({ showClock: v })} />
        </SettingField>
        {showClock && (
          <SettingField id="clockShowSeconds">
            <Toggle checked={config.clockShowSeconds ?? false} onChange={(v) => onSave({ clockShowSeconds: v })} />
          </SettingField>
        )}
      </Section>
    </>
  );
}
