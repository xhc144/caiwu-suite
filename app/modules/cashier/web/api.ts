import { moduleApi, queryClient } from '@caiwu/web-kit';
import type { inferRouterOutputs } from '@trpc/server';
import type { CashierRouter } from '../server/router';
export const api = moduleApi<CashierRouter>('cashier');
export type Outputs = inferRouterOutputs<CashierRouter>;
export type CashAccount = Outputs['accounts'][number];
export type CashDocument = Outputs['documents'][number];
export const refresh = () => queryClient.invalidateQueries({ queryKey: api.pathKey() });
