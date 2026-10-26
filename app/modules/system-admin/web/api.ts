import { moduleApi } from '@caiwu/web-kit';
import type { SystemAdminRouter } from '../server/router';
export const api = moduleApi<SystemAdminRouter>('system-admin');
