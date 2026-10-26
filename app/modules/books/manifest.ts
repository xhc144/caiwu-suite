import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'books',
  name: '账套与会计制度',
  products: 'all',
  entryPages: ['bookPicker'],
  permissions: [
    { id: 'books.view', name: '查看账套' },
    { id: 'books.edit', name: '维护账套信息' },
    { id: 'books.copy', name: '复制账套' },
    { id: 'books.delete', name: '删除账套' },
  ],
  menu: [
    { group: 'system', title: '账套管理', path: '/manage', permission: 'books.view' },
    { group: 'system', title: '账套信息', path: '/info', permission: 'books.view' },
    { group: 'system', title: '切换账套', path: '/switch' },
  ],
});
