import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'costing',
  name: '成本核算',
  description: '月末加权成本核算、出入库与盘点凭证、收入成本利润及销售明细',
  products: ['chengben'],
  dependsOn: ['inventory'],
  permissions: [
    { id: 'costing.view', name: '查看成本与利润' },
    { id: 'costing.worksheet', name: '保存和取消成本试算' },
    { id: 'costing.calculate', name: '正式核算和取消核算' },
    { id: 'costing.voucher', name: '成本单据凭证' },
  ],
  menu: [
    { group: 'costing', title: '成本核算', path: '/calculation', permission: 'costing.view' },
    {
      group: 'costing',
      title: '生产成本分摊',
      path: '/production',
      permission: 'costing.calculate',
    },
    { group: 'costing', title: '收入成本利润表', path: '/profit', permission: 'costing.view' },
    { group: 'costing', title: '销售明细账', path: '/sales', permission: 'costing.view' },
    {
      group: 'costing',
      title: '出入库与盘点凭证',
      path: '/vouchers',
      permission: 'costing.voucher',
    },
    {
      group: 'costing',
      title: '日期批量制证',
      path: '/voucher-batch',
      permission: 'costing.voucher',
    },
  ],
  sources: [
    { type: 'worksheet', name: '成本试算', path: '/calculation?id={id}' },
    { type: 'receipt', name: '入库单', path: '/vouchers?documentId={id}&purpose=receipt' },
    { type: 'revenue', name: '销售收入', path: '/vouchers?documentId={id}&purpose=revenue' },
    { type: 'cost', name: '出库成本', path: '/vouchers?documentId={id}&purpose=cost' },
    { type: 'count', name: '盘点表', path: '/vouchers?countId={id}&purpose=count' },
    { type: 'profit', name: '净利润结转', path: '/profit?period={id}' },
  ],
});
