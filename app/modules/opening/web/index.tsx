import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [{ path: '/', title: '期初余额', component: lazy(() => import('./OpeningPage')) }],
});
