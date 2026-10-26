import { defineManifest } from '@caiwu/core';
export default defineManifest({
  id: 'inventory',
  name: '仓库进销存',
  description: '产品、期初、出入库、采购合同、库存与盘点',
  products: ['chengben'],
  permissions: [
    { id: 'inventory.view', name: '查看仓库业务' },
    { id: 'inventory.edit', name: '维护仓库业务' },
    { id: 'inventory.import', name: '导入仓库数据' },
    { id: 'inventory.audit', name: '审核仓库单据' },
    { id: 'inventory.audit-admin', name: '撤销他人仓库审核' },
    { id: 'inventory.negative-stock', name: '确认负库存例外' },
    { id: 'inventory.settings', name: '设置仓库参数' },
  ],
  menu: [
    { group: 'inventory', title: '产品与仓库', path: '/master', permission: 'inventory.view' },
    { group: 'inventory', title: '库存期初', path: '/opening', permission: 'inventory.view' },
    { group: 'inventory', title: '入库单管理', path: '/receipts', permission: 'inventory.view' },
    { group: 'inventory', title: '出库单管理', path: '/issues', permission: 'inventory.view' },
    { group: 'inventory', title: '采购合同', path: '/contracts', permission: 'inventory.view' },
    { group: 'inventory', title: '库存与台账', path: '/stock', permission: 'inventory.view' },
    { group: 'inventory', title: '月末盘点', path: '/counts', permission: 'inventory.view' },
    { group: 'inventory', title: '汇总与销售明细', path: '/reports', permission: 'inventory.view' },
    { group: 'inventory', title: '仓库设置', path: '/settings', permission: 'inventory.view' },
  ],
  sources: [{ type: 'document', name: '仓库单据', path: '/receipts?id={id}' }],
});
