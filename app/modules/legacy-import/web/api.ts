import { moduleApi } from '@caiwu/web-kit';
import type { ImportRouter } from '../server/router';

export const api = moduleApi<ImportRouter>('legacy-import');
