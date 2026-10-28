import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'cashier',
  name: '出纳',
  description: '同账套收付单、来源凭证与出纳账—财务账核对',
  products: 'all',
  permissions: [
    { id: 'cashier.reset', name: '备份后重新初始化出纳' },
    { id: 'cashier.check.edit', name: '领用及签发支票' },
    { id: 'cashier.check.settle', name: '登记支票兑付或作废' },
    { id: 'cashier.period.close', name: '出纳结账' },
    { id: 'cashier.period.reopen', name: '出纳反结账' },
    { id: 'cashier.view', name: '查看出纳账' },
    { id: 'cashier.account.edit', name: '启用出纳及维护账户期初' },
    { id: 'cashier.document.edit', name: '编辑出纳单据' },
    { id: 'cashier.voucher.generate', name: '生成及撤销出纳凭证' },
    { id: 'cashier.reconcile', name: '出纳勾账及取消勾账' },
  ],
  menu: [
    { group: 'cashier', title: '支票登记簿', path: '/checks', permission: 'cashier.view' },
    { group: 'cashier', title: '出纳结账与反结账', path: '/periods', permission: 'cashier.view' },
    { group: 'cashier', title: '出纳账户与期初', path: '/accounts', permission: 'cashier.view' },
    { group: 'cashier', title: '出纳收付单', path: '/documents', permission: 'cashier.view' },
    { group: 'cashier', title: '和账务对账', path: '/reconcile', permission: 'cashier.view' },
    { group: 'cashier', title: '出纳日记账与汇总', path: '/reports', permission: 'cashier.view' },
  ],
  sources: [{ type: 'batch', name: '出纳生成批次', path: '/documents?batch={id}' }],
});
