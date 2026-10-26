import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [{ path: '/', title: '备份恢复', component: lazy(() => import('./BackupPage')) }],
});
