import { moduleApi } from '@caiwu/web-kit';
import type { CostingRouter } from '../server/router';
export const api = moduleApi<CostingRouter>('costing');
