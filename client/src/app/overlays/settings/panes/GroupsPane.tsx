import { useState } from 'react';
import { Section, SettingRow, TextInput } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

export function GroupsPane({ config, onSave }: PaneProps) {
  const saved = config.othersFolderName ?? 'Others';

  // The field is a draft committed on blur, so it needs local state — but it must
  // follow the saved value when that moves under us (another window, a Reset all).
  // Reconciled during render rather than in an effect: no cascading re-render, and
  // the input never paints one frame of the stale name.
  const [draft, setDraft] = useState(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setDraft(saved);
  }

  return (
    <Section title="Naming">
      <SettingRow label='"Others" folder name' hint="Display name for the ungrouped shells bucket">
        <TextInput
          value={draft}
          onChange={setDraft}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed.length >= 1) onSave({ othersFolderName: trimmed });
            else setDraft(saved);
          }}
        />
      </SettingRow>
    </Section>
  );
}
