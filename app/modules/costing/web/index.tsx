import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/calculation', title: '成本试算', component: lazy(() => import('./CalculationPage')) },
    { path: '/profit', title: '收入成本利润表', component: lazy(() => import('./ProfitPage')) },
    { path: '/vouchers', title: '出入库凭证预览', component: lazy(() => import('./VoucherPage')) },
  ],
});
