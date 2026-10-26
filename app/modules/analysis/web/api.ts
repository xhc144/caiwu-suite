import { moduleApi } from '@caiwu/web-kit';
import type { AnalysisRouter } from '../server/router';
export const api = moduleApi<AnalysisRouter>('analysis');
