import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';

export default defineWebModule(manifest, {
  routes: [{ path: '/', title: '原账迁移', component: lazy(() => import('./LegacyImportPage')) }],
});
