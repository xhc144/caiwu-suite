import { moduleApi } from '@caiwu/web-kit';
import type { ReportRouter } from '../server/router';

export const api = moduleApi<ReportRouter>('report-engine');
