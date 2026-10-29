import { DEFAULT_CONFIG, type ClaudeRenderer, type SessionViewMode } from '@argus/shared';
import { Section, Segmented } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';
import { SettingField } from '../SettingField.js';
import { RENDERER_OPTIONS, VIEW_OPTIONS } from '../options.js';

/**
 * How Claude sessions draw their UI. Lives in Agents because it is a Claude
 * option, applied per spawned process — the user's own Claude config is never
 * written. Takes effect for new and restarted sessions only.
 */
export function ClaudeRendererSection({ config, onSave }: Pick<PaneProps, 'config' | 'onSave'>) {
  const value: ClaudeRenderer = config.claudeRenderer ?? 'fullscreen';
  const view: SessionViewMode = config.defaultSessionView ?? DEFAULT_CONFIG.defaultSessionView!;
  return (
    <Section title="Claude display">
      <SettingField id="claudeRenderer" config={config}>
        <Segmented
          label="Claude renderer"
          value={value}
          options={RENDERER_OPTIONS}
          compact
          onChange={(next) => { void onSave({ claudeRenderer: next }); }}
        />
      </SettingField>
      <SettingField id="defaultSessionView">
        <Segmented
          label="Default view for Claude shells"
          value={view}
          options={VIEW_OPTIONS}
          compact
          onChange={(next) => { void onSave({ defaultSessionView: next }); }}
        />
      </SettingField>
    </Section>
  );
}
