import type { AppConfig } from '@argus/shared';

/** What every settings pane gets: the live config and one way to write to it.
 *  Panes never hold config state of their own — they render `config` and call
 *  `onSave` with a patch, so a save from anywhere re-renders every pane. */
export interface PaneProps {
  config: AppConfig;
  onSave: (data: Partial<AppConfig>) => Promise<AppConfig>;
}
