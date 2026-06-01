import { api } from '../services/api.js';
import { useOrder } from './useOrder.js';

export function useSessionOrder() {
  return useOrder({ load: api.getSessionOrder, save: api.saveSessionOrder });
}
