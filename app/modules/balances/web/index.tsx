import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

export default defineWebModule(manifest, {
  routes: [
    { path: '/', title: '汇总余额表', component: lazy(() => import('./BalancesPage')) },
    { path: '/foreign', title: '外币余额表', component: lazy(() => import('./BalancesPage')) },
  ],
});
