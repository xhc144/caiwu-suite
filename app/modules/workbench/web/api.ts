import { moduleApi } from '@caiwu/web-kit';
import type { WorkbenchRouter } from '../server/router';
export const api = moduleApi<WorkbenchRouter>('workbench');
