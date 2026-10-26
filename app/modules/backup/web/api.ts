import { moduleApi } from '@caiwu/web-kit';
import type { BackupRouter } from '../server/router';
export const api = moduleApi<BackupRouter>('backup');
