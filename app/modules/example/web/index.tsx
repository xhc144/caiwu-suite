import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

export default defineWebModule(manifest, {
  routes: [{ path: '/memos', title: '示范记账单', component: lazy(() => import('./MemoPage')) }],
});
