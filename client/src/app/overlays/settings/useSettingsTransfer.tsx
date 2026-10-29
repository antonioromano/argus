import { useCallback, useState, type ReactNode } from 'react';
import type { AppConfig, Launcher, SessionTemplate } from '@argus/shared';
import { api } from '../../../services/api.js';
import { pushToast } from '../../../components/primitives/Toast.js';
import { toastError } from '../../../errors/toastError.js';
import { buildExport, serializeExport } from '../../../settings-backup/buildExport.js';
import { parseSettingsFile } from '../../../settings-backup/parseSettingsFile.js';
import { diffImport, type ImportCurrent, type ImportPlan, type ImportSection } from '../../../settings-backup/diffImport.js';
import { applyImport, importSummary, type ApplyDeps } from '../../../settings-backup/applyImport.js';
import { ImportPreviewSheet } from './ImportPreviewSheet.js';

/** Stamped by Vite; absent under Vitest. */
const APP_VERSION = typeof __ARGUS_VERSION__ === 'string' ? __ARGUS_VERSION__ : undefined;

/** Templates live behind their beta (the route 404s while it is off). */
async function loadTemplates(config: AppConfig): Promise<SessionTemplate[]> {
  if (config.betaSessionTemplates !== true) return [];
  return api.listTemplates().catch(() => []);
}

async function loadLaunchers(): Promise<Launcher[]> {
  return (await window.electronLaunch?.launchers.list().catch(() => [])) ?? [];
}

async function loadCurrent(config: AppConfig): Promise<ImportCurrent> {
  const [templates, launchers] = await Promise.all([loadTemplates(config), loadLaunchers()]);
  return { config, templates, launchers };
}

interface Preview {
  plan: ImportPlan;
  current: ImportCurrent;
}

export interface SettingsTransfer {
  /** False outside Electron: the file dialogs and launcher store live in main. */
  available: boolean;
  exportSettings: () => Promise<void>;
  importSettings: () => Promise<void>;
  /** The import preview, while one is open. Render it beside the settings sheet. */
  sheet: ReactNode;
}

/**
 * Export and import of the settings backup file. Export: build the document
 * from config, templates and launchers, then main's save dialog. Import: main's
 * open dialog, parse, preview; on apply, back the current state up first, then
 * the three ordered writes of applyImport.
 */
export function useSettingsTransfer(config: AppConfig, onSave: (patch: Partial<AppConfig>) => Promise<AppConfig>): SettingsTransfer {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applying, setApplying] = useState(false);
  const bridge = typeof window === 'undefined' ? undefined : window.electronSettings;

  const exportSettings = useCallback(async () => {
    if (!bridge) return;
    try {
      const current = await loadCurrent(config);
      const text = serializeExport(buildExport({ ...current, appVersion: APP_VERSION }));
      const res = await bridge.saveFile(text);
      if (!res.ok) {
        if (!res.canceled) toastError(new Error(res.error ?? 'refused'), 'Couldn’t export settings');
        return;
      }
      pushToast('Settings exported', 'ok', { action: { label: 'Show in Finder', run: () => { void bridge.reveal('export'); } } });
    } catch (err) {
      toastError(err, 'Couldn’t export settings');
    }
  }, [bridge, config]);

  const importSettings = useCallback(async () => {
    if (!bridge) return;
    try {
      const res = await bridge.openFile();
      if (!res.ok) {
        if (!res.canceled) toastError(new Error(res.error ?? 'refused'), 'Couldn’t open the file');
        return;
      }
      const parsed = parseSettingsFile(res.text ?? '');
      if (!parsed.ok) {
        toastError(new Error(parsed.error), 'Couldn’t import');
        return;
      }
      const current = await loadCurrent(config);
      setPreview({ plan: diffImport(parsed.value, current), current });
    } catch (err) {
      toastError(err, 'Couldn’t import');
    }
  }, [bridge, config]);

  const apply = useCallback(async (selected: Set<string>) => {
    if (!bridge || !preview) return;
    setApplying(true);
    try {
      // Back up before the first write, so the import can be undone by hand.
      const backup = await bridge.backup(serializeExport(buildExport({ ...preview.current, appVersion: APP_VERSION })));
      if (!backup.ok) {
        toastError(new Error(backup.error ?? 'refused'), 'Import stopped: couldn’t back up your current settings');
        return;
      }
      const deps: ApplyDeps = {
        updateConfig: onSave,
        createTemplate: (req) => api.createTemplate(req),
        updateTemplate: (id, req) => api.updateTemplate(id, req),
        importLaunchers: async (items) => {
          const run = window.electronLaunch?.launchers.import;
          if (!run) throw new Error('launchers can only be imported in the desktop app');
          const r = await run(items);
          if (!r.ok) throw new Error(r.error);
          return r.results;
        },
      };
      const result = await applyImport(preview.plan, selected, preview.current, deps);
      setPreview(null);
      const partial = !result.ok || result.templates.failed.length > 0 || result.launchers.failed.length > 0
        || !!result.templates.skippedReason;
      pushToast(importSummary(result), result.ok ? (partial ? 'warn' : 'ok') : 'danger', {
        action: { label: 'Show backup', run: () => { void bridge.reveal('backup'); } },
        durationMs: 10_000,
      });
    } catch (err) {
      toastError(err, 'Import failed');
    } finally {
      setApplying(false);
    }
  }, [bridge, preview, onSave]);

  // Templates need their beta. Say so up front unless the file itself turns it on.
  const sectionNotes: Partial<Record<ImportSection, string>> = {};
  if (preview && preview.current.config.betaSessionTemplates !== true
    && preview.plan.items.some((i) => i.section === 'templates')) {
    const turnsOn = preview.plan.items.some((i) => i.ref === 'betaSessionTemplates' && preview.plan.parsed.preferences.betaSessionTemplates === true);
    sectionNotes.templates = turnsOn
      ? 'Imported only if “Session templates” (Beta features) is also selected above.'
      : 'Turn on Session templates in Beta features to import these.';
  }

  return {
    available: !!bridge,
    exportSettings,
    importSettings,
    sheet: preview ? (
      <ImportPreviewSheet
        plan={preview.plan}
        sectionNotes={sectionNotes}
        applying={applying}
        onApply={(s) => void apply(s)}
        onCancel={() => setPreview(null)}
      />
    ) : null,
  };
}
