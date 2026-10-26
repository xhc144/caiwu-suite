import { moduleApi } from '@caiwu/web-kit';
import type { MasterdataRouter } from '../server/router';

export const api = moduleApi<MasterdataRouter>('masterdata');
