import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'system-admin',
  name: '系统管理',
  description: '用户、功能授权、操作日志、综合检查与通用审计资料',
  products: 'all',
  entryPages: ['login'],
  permissions: [
    { id: 'system-admin.view', name: '进入系统管理与切换用户' },
    { id: 'system-admin.users.manage', name: '管理用户' },
    { id: 'system-admin.permissions.manage', name: '分配功能权限' },
    { id: 'system-admin.password', name: '修改本人密码' },
    { id: 'system-admin.password.reset', name: '重置用户密码' },
    { id: 'system-admin.logs.view', name: '查看操作日志' },
    { id: 'system-admin.audit.export', name: '导出通用审计资料' },
    { id: 'system-admin.check', name: '运行综合检查' },
    { id: 'system-admin.reset', name: '系统初始化预检' },
  ],
  menu: [
    { group: 'system', title: '用户管理', path: '/users', permission: 'system-admin.users.manage' },
    { group: 'system', title: '自改密码', path: '/password', permission: 'system-admin.password' },
    { group: 'system', title: '切换用户', path: '/switch', permission: 'system-admin.view' },
    { group: 'system', title: '操作日志', path: '/logs', permission: 'system-admin.logs.view' },
    {
      group: 'system',
      title: '综合检查',
      path: '/check',
      permission: 'system-admin.check',
      shortcut: 'Shift+F10',
    },
    {
      group: 'system',
      title: '通用审计资料',
      path: '/audit',
      permission: 'system-admin.audit.export',
    },
    { group: 'system', title: '系统初始化预检', path: '/reset', permission: 'system-admin.reset' },
  ],
});
