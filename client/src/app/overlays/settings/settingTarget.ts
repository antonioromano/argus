import { createContext, useContext } from 'react';

/** The setting a jump is currently flashing, provided by SettingsOverlay. */
export const SettingTargetContext = createContext<string | null>(null);

/** Whether `id` is the row a search hit or deep link just jumped to. */
export function useIsSettingTarget(id: string): boolean {
  return useContext(SettingTargetContext) === id;
}

/** DOM attributes that make any element a jump target for setting `id`:
 *  the scroll anchor, the id search looks up, and the flash class. */
export function settingAnchorProps(id: string, isTarget: boolean, className?: string) {
  const classes = [className, isTarget ? 'is-target' : undefined].filter(Boolean).join(' ');
  return {
    id: `setting-${id}`,
    'data-setting-id': id,
    className: classes || undefined,
  };
}
