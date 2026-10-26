import { moduleApi } from '@caiwu/web-kit';
import type { PayrollRouter } from '../server/router';
export const api = moduleApi<PayrollRouter>('payroll');
