import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/preview', title: '打印与导出', component: lazy(() => import('./PrintPage')) },
    { path: '/formats', title: '特殊打印格式', component: lazy(() => import('./FormatsPage')) },
  ],
});
