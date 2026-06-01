import { api } from '../services/api.js';
import { useOrder } from './useOrder.js';

/** Mosaic-only tile order — persisted separately from the global session order. */
export function useMosaicOrder() {
  return useOrder({ load: api.getMosaicOrder, save: api.saveMosaicOrder });
}
