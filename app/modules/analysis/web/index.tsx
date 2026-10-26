import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/', title: '科目分析', component: lazy(() => import('./TrendPage')) },
    { path: '/aging', title: '账龄分析', component: lazy(() => import('./AgingPage')) },
    { path: '/contracts', title: '合同档案管理', component: lazy(() => import('./ContractsPage')) },
    {
      path: '/contract-balances',
      title: '合同账款查询',
      component: lazy(() => import('./ContractBalancesPage')),
    },
  ],
});
