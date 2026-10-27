import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'costing',
  name: '成本核算',
  description: '单月正式成本发布与撤销、出库成本制证与撤销、收入成本利润',
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
    { group: 'costing', title: '收入成本利润表', path: '/profit', permission: 'costing.view' },
    { group: 'costing', title: '出入库凭证预览', path: '/vouchers', permission: 'costing.voucher' },
  ],
  sources: [
    { type: 'worksheet', name: '成本试算', path: '/calculation?id={id}' },
    ...(['receipt', 'revenue', 'cost'] as const).map((type) => ({
      type,
      name: type === 'receipt' ? '入库凭证' : type === 'revenue' ? '销售收入凭证' : '出库成本凭证',
      path: `/vouchers?id={id}&purpose=${type}`,
    })),
  ],
});
