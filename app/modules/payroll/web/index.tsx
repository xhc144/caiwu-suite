import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
const component = lazy(() => import('./PayrollPage'));
export default defineWebModule(manifest, {
  routes: [
    { path: '/', title: '工资管理', component },
    { path: '/employees', title: '人事档案', component },
    { path: '/structure', title: '工资结构与公式', component },
    { path: '/tax', title: '计税参数', component },
  ],
});
