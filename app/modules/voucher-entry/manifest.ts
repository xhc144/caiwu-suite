import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'voucher-entry',
  name: '凭证录入',
  products: 'all',
  permissions: [
    { id: 'voucher-entry.view', name: '查看凭证' },
    { id: 'voucher-entry.edit', name: '录入修改凭证' },
    { id: 'voucher-entry.template', name: '维护凭证模版' },
  ],
  menu: [
    {
      group: 'voucher',
      title: '凭证录入',
      path: '/new',
      permission: 'voucher-entry.view',
      keywords: ['pzlr'],
    },
    {
      group: 'voucher',
      title: '凭证修改',
      path: '/edit',
      permission: 'voucher-entry.view',
      keywords: ['pzxg', '凭证浏览'],
    },
    {
      group: 'voucher',
      title: '凭证模版',
      path: '/templates',
      permission: 'voucher-entry.view',
      keywords: ['pzmb'],
    },
  ],
});
