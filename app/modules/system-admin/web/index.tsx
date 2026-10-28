import { lazy } from 'react';
import { defineWebModule } from '@caiwu/web-kit';
import manifest from '../manifest';
import LoginPage from './LoginPage';

export default defineWebModule(manifest, {
  entryPages: { login: LoginPage },
  routes: [
    { path: '/users', title: '用户管理', component: lazy(() => import('./UsersPage')) },
    { path: '/password', title: '自改密码', component: lazy(() => import('./PasswordPage')) },
    {
      path: '/operation-date',
      title: '操作日期',
      component: lazy(() => import('./OperationDatePage')),
    },
    { path: '/switch', title: '切换用户', component: lazy(() => import('./SwitchPage')) },
    { path: '/logs', title: '操作日志', component: lazy(() => import('./LogsPage')) },
    { path: '/check', title: '综合检查', component: lazy(() => import('./CheckPage')) },
    { path: '/audit', title: '通用审计资料', component: lazy(() => import('./AuditPage')) },
    { path: '/reset', title: '系统初始化', component: lazy(() => import('./ResetPage')) },
  ],
});
