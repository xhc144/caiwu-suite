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
    {
      group: 'ledger',
      title: '现金流量试算平衡表',
      path: '/cashflow',
      permission: 'balances.view',
    },
    { group: 'ledger', title: '汇总余额表', path: '/', permission: 'balances.view' },
    { group: 'ledger', title: '外币余额表', path: '/foreign', permission: 'balances.view' },
    { group: 'ledger', title: '数量余额表', path: '/quantity', permission: 'balances.view' },
    { group: 'ledger', title: '辅助余额表', path: '/auxiliary', permission: 'balances.view' },
    {
      group: 'ledger',
      title: '辅助外币余额表',
      path: '/auxiliary/foreign',
      permission: 'balances.view',
    },
    {
      group: 'ledger',
      title: '辅助数量余额表',
      path: '/auxiliary/quantity',
      permission: 'balances.view',
    },
  ],
});
