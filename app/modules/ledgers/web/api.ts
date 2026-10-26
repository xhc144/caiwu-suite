import { moduleApi } from '@caiwu/web-kit';
import type { LedgersRouter } from '../server/router';

export const api = moduleApi<LedgersRouter>('ledgers');
