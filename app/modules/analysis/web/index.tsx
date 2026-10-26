import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
export default defineWebModule(manifest, {
  routes: [
    { path: '/', title: '科目分析', component: lazy(() => import('./TrendPage')) },
    { path: '/aging', title: '账龄分析', component: lazy(() => import('./AgingPage')) },
  ],
});
