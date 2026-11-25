import { useState, useEffect, useCallback } from 'react';
import type { AppConfig } from '@argus/shared';
import { api } from '../services/api.js';

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  // When this window last changed config itself (not a reload of another
  // window's change): profiles write back only after a local edit.
  const [localEditAt, setLocalEditAt] = useState(0);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error).finally(() => setLoading(false));
  }, []);

  const updateConfig = useCallback(async (data: Partial<AppConfig>): Promise<AppConfig> => {
    const updated = await api.updateConfig(data);
    setConfig(updated);
    setLocalEditAt(Date.now());
    return updated;
  }, []);

  /** Re-read config from the server (another window switched profile). */
  const reload = useCallback(async (): Promise<void> => {
    try { setConfig(await api.getConfig()); } catch (err) { console.error(err); }
  }, []);

  return { config, loading, updateConfig, reload, localEditAt };
}
