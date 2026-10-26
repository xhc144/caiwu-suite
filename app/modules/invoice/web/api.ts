import { moduleApi } from '@caiwu/web-kit';
import type { InvoiceRouter } from '../server/router';
export const api = moduleApi<InvoiceRouter>('invoice');
