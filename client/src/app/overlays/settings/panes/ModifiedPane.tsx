import { CheckCircle2, RotateCcw } from 'lucide-react';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { Button, EmptyState, Section, SettingRow } from '../../../../components/primitives/index.js';
import { settingValueLabel, type SettingDescriptor } from '../catalog.js';
import { PANES_BY_ID, modifiedSettings } from '../registry.js';

interface ModifiedPaneProps {
  config: AppConfig;
  /** Reset one setting to its default (the shell offers Undo). */
  onReset: (s: SettingDescriptor) => void;
  /** Open the pane holding the setting, scrolled to and flashed. */
  onGoTo: (id: string) => void;
}

/**
 * Every setting that differs from its shipped default, across all panes: where
 * it lives, what it is now and what it would go back to. A virtual pane, so the
 * rows are built from the catalog rather than rendered by the owning pane.
 */
export function ModifiedPane({ config, onReset, onGoTo }: ModifiedPaneProps) {
  const rows = modifiedSettings(config);

  if (rows.length === 0) {
    return <EmptyState icon={CheckCircle2} title="Everything is at its default" />;
  }

  return (
    <Section>
      {rows.map((s) => {
        const now = settingValueLabel(s, config);
        const was = settingValueLabel(s, DEFAULT_CONFIG);
        return (
          <div key={s.id} data-modified-row={s.id}>
            <SettingRow
              label={s.label}
              hint={`${PANES_BY_ID[s.pane].label} › ${s.section}${now && was ? ` · ${now} → ${was}` : ''}`}
            >
              <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
                <Button variant="ghost" size="sm" onClick={() => onGoTo(s.id)}>Go to</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  title={was ? `Reset to ${was}` : 'Reset to default'}
                  onClick={() => onReset(s)}
                >
                  Reset
                </Button>
              </div>
            </SettingRow>
          </div>
        );
      })}
    </Section>
  );
}
