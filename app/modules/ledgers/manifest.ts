import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'ledgers',
  name: '账簿',
  products: 'all',
  permissions: [
    { id: 'ledgers.view', name: '查看账簿' },
    { id: 'ledgers.export', name: '导出账簿' },
    { id: 'ledgers.print', name: '打印账簿' },
    { id: 'ledgers.config.edit', name: '保存账簿格式' },
  ],
  menu: [
    { group: 'ledger', title: '总分类账', path: '/general', permission: 'ledgers.view' },
    { group: 'ledger', title: '三栏明细账', path: '/detail', permission: 'ledgers.view' },
    { group: 'ledger', title: '现金日记账', path: '/cash', permission: 'ledgers.view' },
    { group: 'ledger', title: '银行日记账', path: '/bank', permission: 'ledgers.view' },
    { group: 'ledger', title: '多栏账', path: '/multi', permission: 'ledgers.view' },
    { group: 'ledger', title: '辅助多栏账', path: '/auxiliary-multi', permission: 'ledgers.view' },
    { group: 'ledger', title: '辅助明细账', path: '/auxiliary', permission: 'ledgers.view' },
    { group: 'ledger', title: '数量金额明细账', path: '/quantity', permission: 'ledgers.view' },
    { group: 'ledger', title: '复币明细账', path: '/foreign', permission: 'ledgers.view' },
    {
      group: 'ledger',
      title: '数量复币明细账',
      path: '/quantity-foreign',
      permission: 'ledgers.view',
    },
    { group: 'ledger', title: '增值税明细账', path: '/vat', permission: 'ledgers.view' },
  ],
});
