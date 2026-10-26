import { moduleApi, queryClient } from '@caiwu/web-kit';
import type { inferRouterOutputs } from '@trpc/server';
import type { CashierRouter } from '../server/router';
export const api = moduleApi<CashierRouter>('cashier');
export type Outputs = inferRouterOutputs<CashierRouter>;
export type CashAccount = Outputs['accounts'][number];
export type CashDocument = Outputs['documents'][number];
// 预览绑定用户选择的单据 revision；写入成功后该快照已失效，不能随列表重刷。
// 只刷新持久化视图，重新预览须由用户重新选择/提交输入。
export const refresh = () =>
  Promise.all(
    [
      api.checks.queryKey(),
      api.periods.queryKey(),
      api.status.queryKey(),
      api.accounts.queryKey(),
      api.documents.queryKey(),
      api.reconcile.queryKey(),
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
