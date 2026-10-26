import { moduleApi } from '@caiwu/web-kit';
import type { BalancesRouter } from '../server/router';

export const api = moduleApi<BalancesRouter>('balances');
