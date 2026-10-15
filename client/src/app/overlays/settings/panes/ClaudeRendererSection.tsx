import type { ClaudeRenderer } from '@argus/shared';
import { Section, SettingRow, Segmented } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

const OPTIONS: readonly { value: ClaudeRenderer; label: string; title: string }[] = [
  { value: 'fullscreen', label: 'Fullscreen', title: 'Claude redraws its own history on resize — no duplicated messages' },
  { value: 'classic', label: 'Classic', title: 'Terminal scrollback — resizing can leave duplicated messages' },
  { value: 'inherit', label: 'My setting', title: 'Use the tui value from your own Claude settings' },
];

const HINT: Record<ClaudeRenderer, string> = {
  fullscreen: 'Claude keeps its own scrollback and re-lays it out when a tile resizes. Scroll, select and search inside Claude.',
  classic: 'Native terminal scrollback. Each width change makes Claude reprint its transcript, which can leave duplicated messages behind.',
  inherit: 'Argus adds nothing — the tui value in your ~/.claude/settings.json decides.',
};

/**
 * How Claude sessions draw their UI. Lives in Agents because it is a Claude
 * option, applied per spawned process — the user's own Claude config is never
 * written. Takes effect for new and restarted sessions only.
 */
export function ClaudeRendererSection({ config, onSave }: Pick<PaneProps, 'config' | 'onSave'>) {
  const value: ClaudeRenderer = config.claudeRenderer ?? 'fullscreen';
  return (
    <Section title="Claude display">
      <SettingRow label="Renderer" hint={`${HINT[value]} Applies to new and restarted sessions.`}>
        <Segmented
          label="Claude renderer"
          value={value}
          options={OPTIONS}
          compact
          onChange={(next) => { void onSave({ claudeRenderer: next }); }}
        />
      </SettingRow>
    </Section>
  );
}
