import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/checks', title: '支票登记簿', component: lazy(() => import('./ChecksPage')) },
    { path: '/periods', title: '出纳结账与反结账', component: lazy(() => import('./PeriodsPage')) },
    { path: '/', title: '出纳', component: lazy(() => import('./AccountsPage')) },
    { path: '/accounts', title: '出纳账户与期初', component: lazy(() => import('./AccountsPage')) },
    { path: '/settings', title: '出纳启用设置', component: lazy(() => import('./AccountsPage')) },
    { path: '/documents', title: '出纳收付单', component: lazy(() => import('./DocumentsPage')) },
    { path: '/reconcile', title: '和账务对账', component: lazy(() => import('./ReconcilePage')) },
    { path: '/reports', title: '出纳日记账', component: lazy(() => import('./ReportsPage')) },
  ],
});
