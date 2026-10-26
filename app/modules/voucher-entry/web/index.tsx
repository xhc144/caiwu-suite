import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/new', title: '凭证录入', component: lazy(() => import('./EntryPage')) },
    { path: '/edit', title: '凭证修改', component: lazy(() => import('./EntryPage')) },
    { path: '/templates', title: '凭证模版', component: lazy(() => import('./TemplatePage')) },
  ],
});
