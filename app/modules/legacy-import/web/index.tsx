import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

export default defineWebModule(manifest, {
  routes: [{ path: '/', title: '标准化账务导入', component: lazy(() => import('./ImportPage')) }],
});
