import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/', title: '凭证序时簿', component: lazy(() => import('./BookPage')) },
    { path: '/summary', title: '凭证科目汇总', component: lazy(() => import('./ReportPage')) },
    { path: '/t-account', title: '丁字帐户', component: lazy(() => import('./ReportPage')) },
  ],
});
