import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/cards', title: '固定资产台账', component: lazy(() => import('./CardsPage')) },
    { path: '/masters', title: '资产基础档案', component: lazy(() => import('./MastersPage')) },
    {
      path: '/depreciation',
      title: '计提与取消折旧',
      component: lazy(() => import('./DepreciationPage')),
    },
    { path: '/settings', title: '资产凭证设置', component: lazy(() => import('./SettingsPage')) },
    { path: '/queries', title: '折旧查询与分布', component: lazy(() => import('./QueriesPage')) },
    { path: '/reports', title: '资产报表与标签', component: lazy(() => import('./ReportsPage')) },
    { path: '/opening', title: '期初导入与开通', component: lazy(() => import('./OpeningPage')) },
    { path: '/batch', title: '统一置数', component: lazy(() => import('./BatchPage')) },
  ],
});
