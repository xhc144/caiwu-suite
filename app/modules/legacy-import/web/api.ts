import { moduleApi } from '@caiwu/web-kit';
import type { LegacyImportRouter } from '../server/router';

export const api = moduleApi<LegacyImportRouter>('legacy-import');
