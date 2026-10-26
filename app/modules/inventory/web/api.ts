import { moduleApi } from '@caiwu/web-kit';
import type { InventoryRouter } from '../server/router';
export const api = moduleApi<InventoryRouter>('inventory');
