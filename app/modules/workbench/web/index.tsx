import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
const Home = lazy(() => import('./HomePage'));
export default defineWebModule(manifest, {
  entryPages: { home: Home },
  routes: [
    { path: '/session', title: '会话检查', component: lazy(() => import('./SessionMonitor')) },
    { path: '/', title: '工作台', component: Home },
    { path: '/search', title: '全局搜索', component: lazy(() => import('./SearchPage')) },
    { path: '/settings', title: '工作台设置', component: lazy(() => import('./SettingsPage')) },
    { path: '/help', title: '帮助与关于', component: lazy(() => import('./HelpPage')) },
  ],
});
