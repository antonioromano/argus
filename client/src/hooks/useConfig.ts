import { useState, useEffect, useCallback } from 'react';
import type { AppConfig } from '@argus/shared';
import { api } from '../services/api.js';

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error).finally(() => setLoading(false));
  }, []);

  const updateConfig = useCallback(async (data: Partial<AppConfig>): Promise<AppConfig> => {
    const updated = await api.updateConfig(data);
    setConfig(updated);
    return updated;
  }, []);

  return { config, loading, updateConfig };
}
