import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

export default defineWebModule(manifest, {
  routes: [
    { path: '/', title: '报表管理', component: lazy(() => import('./ListPage')) },
    { path: '/designer', title: '报表定义', component: lazy(() => import('./DesignerPage')) },
    { path: '/view', title: '报表生成', component: lazy(() => import('./ViewPage')) },
  ],
});
