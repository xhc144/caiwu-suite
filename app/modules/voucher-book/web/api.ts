import { moduleApi } from '@caiwu/web-kit';
import type { VoucherBookRouter } from '../server/router';
export const api = moduleApi<VoucherBookRouter>('voucher-book');
