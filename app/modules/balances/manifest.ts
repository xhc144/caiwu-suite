import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'balances',
  name: '余额表',
  products: 'all',
  permissions: [
    { id: 'balances.view', name: '查看余额表' },
    { id: 'balances.export', name: '导出余额表' },
    { id: 'balances.settings.edit', name: '保存余额表展示设置' },
  ],
  menu: [
    { group: 'ledger', title: '汇总余额表', path: '/', permission: 'balances.view' },
    { group: 'ledger', title: '外币余额表', path: '/foreign', permission: 'balances.view' },
  ],
});
