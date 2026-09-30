import type { TileRunningIndicator } from '@argus/shared';
import { Section, SettingRow, Segmented } from '../../../../components/primitives/index.js';
import { QuickActionPreview } from '../../QuickActionSheet.js';
import { QuickActionPicker } from '../../../ui/QuickActionPicker.js';
import { DEFAULT_TILE_QUICK_ACTION } from '../../../../constants/tileActions.js';
import type { PaneProps } from '../types.js';

const INDICATOR_OPTIONS: readonly { value: TileRunningIndicator; label: string }[] = [
  { value: 'hairline', label: 'Hairline' },
  { value: 'off', label: 'Off' },
];

export function ShellHeaderPane({ config, onSave }: PaneProps) {
  const action = config.tileQuickAction ?? DEFAULT_TILE_QUICK_ACTION;
  const indicator = config.tileRunningIndicator ?? 'hairline';

  return (
    <>
      <Section title="Header content">
        <SettingRow
          label="Quick action"
          hint="One action pinned beside the window controls in every shell header. Everything else stays in the ⋯ menu."
        >
          <QuickActionPicker
            value={action}
            onChange={(tileQuickAction) => onSave({ tileQuickAction })}
            defaultAction={DEFAULT_TILE_QUICK_ACTION}
          />
        </SettingRow>
        <SettingRow
          label="Running indicator"
          hint="2px progress hairline under the header while an agent is working"
        >
          <Segmented
            label="Running indicator"
            value={indicator}
            options={INDICATOR_OPTIONS}
            onChange={(tileRunningIndicator) => { void onSave({ tileRunningIndicator }); }}
          />
        </SettingRow>
      </Section>

      {/* The preview sits in its own group below both controls: the quick action
          and the running indicator are the same header widget, so one preview
          covers both, and it reads as a result rather than another setting. */}
      <Section title="Preview">
        <SettingRow hint="Minimize, expand and close are always shown.">
          <div style={{ width: 300 }}>
            <QuickActionPreview action={action} runningIndicator={indicator} />
          </div>
        </SettingRow>
        <SettingRow trailing>
          <button
            onClick={() => onSave({ tileQuickAction: DEFAULT_TILE_QUICK_ACTION, tileRunningIndicator: 'hairline' })}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 'var(--t-micro)',
              color: 'var(--fg-3)',
              textDecoration: 'underline',
            }}
          >
            Reset shell header to defaults
          </button>
        </SettingRow>
      </Section>
    </>
  );
}
