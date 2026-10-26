import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

const component = lazy(() => import('./LedgerPage'));
export default defineWebModule(manifest, {
  routes: [
    { path: '/general', title: '总分类账', component },
    { path: '/detail', title: '三栏明细账', component },
    { path: '/cash', title: '现金日记账', component },
    { path: '/bank', title: '银行日记账', component },
  ],
});
