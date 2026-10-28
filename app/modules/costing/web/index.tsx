import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/calculation', title: '成本核算', component: lazy(() => import('./CalculationPage')) },
    { path: '/profit', title: '收入成本利润表', component: lazy(() => import('./ProfitPage')) },
    { path: '/sales', title: '销售明细账', component: lazy(() => import('./SalesPage')) },
    {
      path: '/vouchers',
      title: '出入库与盘点凭证',
      component: lazy(() => import('./VoucherPage')),
    },
  ],
});
