import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/input', title: '进项发票', component: lazy(() => import('./InvoicePage')) },
    { path: '/output', title: '销项发票', component: lazy(() => import('./InvoicePage')) },
    { path: '/process', title: '发票处理', component: lazy(() => import('./ProcessPage')) },
    { path: '/settings', title: '发票参数设置', component: lazy(() => import('./SettingsPage')) },
    { path: '/vat', title: '增值税比对', component: lazy(() => import('./VatPage')) },
    { path: '/summary', title: '发票汇总', component: lazy(() => import('./SummaryPage')) },
    { path: '/periods', title: '发票结账', component: lazy(() => import('./PeriodsPage')) },
  ],
});
