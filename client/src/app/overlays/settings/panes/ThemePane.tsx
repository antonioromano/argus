import { Section, SettingRow, Segmented, Toggle, Button } from '../../../../components/primitives/index.js';
import { useTheme } from '../../../../context/theme-context.js';
import { WaitingStylePreview } from '../../../ui/WaitingStylePreview.js';
import { SettingField } from '../SettingField.js';
import {
  CODE_FONT_PRESETS,
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
 * How Argus looks: theme, font sizes, mosaic layout, the waiting cue and the
 * toolbar clock. Typography and Toolbar were their own panes (two keys each);
 * they are the same subject, and together still fit a screen.
 */
export function ThemePane({ config, onSave }: PaneProps) {
  const { mode, setMode } = useTheme();
  const codeAtDefault = (config.codeFontSize ?? DEFAULT_CODE_FONT_PX) === DEFAULT_CODE_FONT_PX;
  const uiAtDefault = (config.uiFontSize ?? DEFAULT_UI_FONT_PX) === DEFAULT_UI_FONT_PX;
  const showClock = config.showClock ?? false;

  return (
    <>
      <Section title="Theme">
        <SettingField id="device:themeMode">
          <Segmented label="Theme" value={mode} options={THEME_OPTIONS} onChange={setMode} />
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
        <SettingRow trailing>
          <Button
            variant="ghost"
            onClick={() => { void onSave({ codeFontSize: DEFAULT_CODE_FONT_PX, uiFontSize: DEFAULT_UI_FONT_PX }); }}
            disabled={codeAtDefault && uiAtDefault}
          >
            Reset typography
          </Button>
        </SettingRow>
      </Section>

      <Section title="Shell layout">
        <SettingField id="mosaicOrientation">
          <Segmented
            label="Shell layout"
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
        <SettingRow label="Preview" hint="A waiting shell in the mosaic, animating">
          <WaitingStylePreview style={config.mosaicWaitingStyle ?? 'breathing'} />
        </SettingRow>
      </Section>

      <Section title="Toolbar clock">
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
