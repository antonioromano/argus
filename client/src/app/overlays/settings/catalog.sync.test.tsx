/**
 * R2 — the catalog and the panes cannot drift. Each pane is rendered twice (all
 * defaults, and every boolean on so conditional rows appear). Every labelled
 * row must carry the id of the descriptor it renders, and every descriptor that
 * should be visible must be on screen. A row added without a descriptor, or a
 * descriptor whose row was removed, fails here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { SettingsOverlay } from '../SettingsOverlay.js';
import { PANES, type PaneId } from './registry.js';
import { SETTINGS, isSettingVisible } from './catalog.js';

// Panes fetch on mount; an unreachable server is the state they already handle.
vi.mock('../../../services/api.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.reject(new Error('offline')) }),
}));
// Beta-gated sections bring sockets and their own fetches; they hold no setting rows.
vi.mock('./panes/ChainsSection.js', () => ({ ChainsSection: () => null }));
vi.mock('./panes/TemplatesSection.js', () => ({ TemplatesSection: () => null }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Labelled rows that show something rather than set something. */
const DISPLAY_ONLY_ROWS: readonly { pane: PaneId; label: string }[] = [
  { pane: 'theme', label: 'Preview' },
  { pane: 'shell-header', label: 'Preview as' },
  { pane: 'shell-header', label: 'Simulate' },
  { pane: 'launchers', label: 'Link format' },
];

/** Every boolean preference on, so rows hidden behind a parent toggle render. */
const ALL_ON: AppConfig = Object.fromEntries(
  Object.entries(structuredClone(DEFAULT_CONFIG)).map(([k, v]) => [k, typeof v === 'boolean' ? true : v]),
) as AppConfig;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function renderPane(config: AppConfig, pane: PaneId) {
  act(() => {
    root.render(
      <SettingsOverlay
        config={config}
        sessions={[]}
        onClose={() => {}}
        onSave={async () => config}
        onSaveFlag={async () => {}}
        onDeleteFlag={async () => {}}
        ngrokStatus={null}
        ngrokLoading={false}
        ngrokError={null}
        onNgrokStart={() => {}}
        onNgrokStop={() => {}}
        initialTab={pane}
      />,
    );
  });
  return container.querySelector('main')!;
}

describe.each([
  ['defaults', structuredClone(DEFAULT_CONFIG)],
  ['everything on', ALL_ON],
] as const)('catalog ↔ pane rows (%s)', (_name, config) => {
  for (const pane of PANES) {
    it(`${pane.id}: every labelled row is a catalogued setting`, () => {
      const main = renderPane(config, pane.id);
      const unbound = Array.from(main.querySelectorAll('.setting-row'))
        .filter((r) => r.querySelector('.setting-row-label') && !r.hasAttribute('data-setting-id'))
        .map((r) => r.querySelector('.setting-row-label')!.textContent ?? '')
        .filter((label) => !DISPLAY_ONLY_ROWS.some((d) => d.pane === pane.id && d.label === label));
      expect(unbound).toEqual([]);
    });

    it(`${pane.id}: every visible catalogued setting is on screen`, () => {
      const main = renderPane(config, pane.id);
      const missing = SETTINGS
        .filter((s) => s.pane === pane.id && isSettingVisible(s, config))
        .filter((s) => !main.querySelector(`[data-setting-id="${s.id}"]`))
        .map((s) => s.id);
      expect(missing).toEqual([]);
    });

    it(`${pane.id}: a bound row shows its descriptor's label`, () => {
      const main = renderPane(config, pane.id);
      for (const el of Array.from(main.querySelectorAll<HTMLElement>('.setting-row[data-setting-id]'))) {
        const s = SETTINGS.find((d) => d.id === el.dataset.settingId);
        expect(s, el.dataset.settingId).toBeDefined();
        expect(s!.pane).toBe(pane.id);
        const label = el.querySelector('.setting-row-label')?.textContent ?? '';
        expect(label.startsWith(s!.label), `${s!.id}: "${label}"`).toBe(true);
      }
    });
  }
});
