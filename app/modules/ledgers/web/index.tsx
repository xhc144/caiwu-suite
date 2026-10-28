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
    { path: '/multi', title: '多栏账', component },
    { path: '/auxiliary-multi', title: '辅助多栏账', component },
    { path: '/auxiliary', title: '辅助明细账', component },
    { path: '/quantity', title: '数量金额明细账', component },
    { path: '/foreign', title: '复币明细账', component },
    { path: '/quantity-foreign', title: '数量复币明细账', component },
    { path: '/vat', title: '增值税明细账', component },
  ],
});
