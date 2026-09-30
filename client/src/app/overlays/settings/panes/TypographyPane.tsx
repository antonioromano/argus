import { Section, SettingRow, Segmented, Button } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

/** Font-size presets (px). Defaults (Medium) match DEFAULT_CONFIG: code 13 / ui 14. */
export const DEFAULT_CODE_FONT_PX = 13;
export const DEFAULT_UI_FONT_PX = 14;

const CODE_FONT_PRESETS = [
  { value: '11', label: 'Small' },
  { value: '13', label: 'Medium' },
  { value: '15', label: 'Large' },
  { value: '17', label: 'X-Large' },
] as const;

const UI_FONT_PRESETS = [
  { value: '12', label: 'Small' },
  { value: '14', label: 'Medium' },
  { value: '16', label: 'Large' },
  { value: '18', label: 'X-Large' },
] as const;

/** Snap an unknown stored value to the default preset so the control always
 *  reflects real state rather than rendering nothing selected. */
function preset(presets: readonly { value: string }[], value: number | undefined, defaultPx: number): string {
  const px = String(value ?? defaultPx);
  return presets.some((p) => p.value === px) ? px : String(defaultPx);
}

export function TypographyPane({ config, onSave }: PaneProps) {
  const codeAtDefault = (config.codeFontSize ?? DEFAULT_CODE_FONT_PX) === DEFAULT_CODE_FONT_PX;
  const uiAtDefault = (config.uiFontSize ?? DEFAULT_UI_FONT_PX) === DEFAULT_UI_FONT_PX;

  return (
    <Section title="Font sizes">
      <SettingRow label="Code" hint="Shell terminals, file viewer, and diffs · default Medium">
        <Segmented
          label="Code font size"
          compact
          value={preset(CODE_FONT_PRESETS, config.codeFontSize, DEFAULT_CODE_FONT_PX)}
          options={CODE_FONT_PRESETS}
          onChange={(px) => { void onSave({ codeFontSize: Number(px) }); }}
        />
      </SettingRow>
      <SettingRow label="Interface" hint="Menus, panels, labels, and the rest of the app · default Medium">
        <Segmented
          label="Interface font size"
          compact
          value={preset(UI_FONT_PRESETS, config.uiFontSize, DEFAULT_UI_FONT_PX)}
          options={UI_FONT_PRESETS}
          onChange={(px) => { void onSave({ uiFontSize: Number(px) }); }}
        />
      </SettingRow>
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
  );
}
