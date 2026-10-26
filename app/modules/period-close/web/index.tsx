import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [{ path: '/', title: '过账与结账', component: lazy(() => import('./PeriodClosePage')) }],
});
