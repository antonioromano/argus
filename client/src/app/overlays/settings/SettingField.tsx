import type { ReactNode } from 'react';
import type { AppConfig } from '@argus/shared';
import { SettingRow } from '../../../components/primitives/index.js';
import { SETTINGS_BY_ID, settingHint } from './catalog.js';
import { settingAnchorProps, useIsSettingTarget } from './settingTarget.js';

function descriptor(id: string) {
  const d = SETTINGS_BY_ID[id];
  // A typo here would render an unlabelled row and silently fall out of search.
  if (!d) throw new Error(`SettingField: no catalog entry "${id}"`);
  return d;
}

interface SettingFieldProps {
  /** Catalog id; label and hint come from the descriptor. */
  id: string;
  /** Needed only for settings whose hint depends on the current value. */
  config?: AppConfig;
  children: ReactNode;
}

/**
 * A settings row bound to its catalog descriptor: label and hint are looked up,
 * not written inline, so the filter, the palette and the row cannot disagree.
 */
export function SettingField({ id, config, children }: SettingFieldProps) {
  const d = descriptor(id);
  const isTarget = useIsSettingTarget(id);
  return (
    <SettingRow
      label={d.label}
      hint={settingHint(d, config)}
      anchorId={id}
      className={isTarget ? 'is-target' : undefined}
    >
      {children}
    </SettingRow>
  );
}

/**
 * Jump anchor for a setting that is not a plain row (a card of agent buttons,
 * the terminal picker, a whole list section). Wraps the block without styling
 * it, so it can still be scrolled to and flashed.
 */
export function SettingAnchor({ id, children }: { id: string; children: ReactNode }) {
  descriptor(id);
  const isTarget = useIsSettingTarget(id);
  return <div {...settingAnchorProps(id, isTarget, 'setting-anchor')}>{children}</div>;
}
