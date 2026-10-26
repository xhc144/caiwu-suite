import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
import BookPicker from './BookPicker';

export default defineWebModule(manifest, {
  entryPages: { bookPicker: BookPicker },
  routes: [
    { path: '/manage', title: '账套管理', component: lazy(() => import('./ManagePage')) },
    { path: '/info', title: '账套信息', component: lazy(() => import('./InfoPage')) },
    { path: '/switch', title: '切换账套', component: lazy(() => import('./SwitchPage')) },
  ],
});
