import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

export default defineWebModule(manifest, {
  routes: [
    { path: '/accounts', title: '科目维护', component: lazy(() => import('./AccountsPage')) },
    { path: '/dimensions', title: '辅助档案', component: lazy(() => import('./DimensionsPage')) },
    { path: '/reference', title: '参考档案', component: lazy(() => import('./ReferencePage')) },
  ],
});
