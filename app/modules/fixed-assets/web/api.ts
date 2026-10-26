import { moduleApi } from '@caiwu/web-kit';
import type { inferRouterOutputs } from '@trpc/server';
import type { FixedAssetsRouter } from '../server/router';
export const api = moduleApi<FixedAssetsRouter>('fixed-assets');
export type Outputs = inferRouterOutputs<FixedAssetsRouter>;
