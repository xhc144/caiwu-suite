import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
const component = lazy(() => import('./PayrollPage'));
export default defineWebModule(manifest, {
  routes: [
    {
      path: '/transfer',
      title: '工资转入与模块备份',
      component: lazy(() => import('./TransferPage')),
    },
    {
      path: '/initialize',
      title: '工资系统初始化',
      component: lazy(() => import('./InitializationDrawer')),
    },
    { path: '/batch', title: '工资批次', component },
    { path: '/query', title: '工资综合查询', component: lazy(() => import('./QueryPage')) },
    { path: '/reports', title: '工资报表', component: lazy(() => import('./ReportsPage')) },
    { path: '/', title: '工资管理', component },
    { path: '/employees', title: '人事档案', component },
    { path: '/structure', title: '工资结构与公式', component },
    { path: '/tax', title: '计税参数', component },
  ],
});
