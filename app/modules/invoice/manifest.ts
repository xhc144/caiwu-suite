import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'invoice',
  name: '发票',
  products: ['qingsong', 'chengben'],
  permissions: [
    { id: 'invoice.view', name: '查看发票和账票比对' },
    { id: 'invoice.edit', name: '录入修改删除发票' },
    { id: 'invoice.import', name: '导入发票' },
    { id: 'invoice.audit', name: '审核发票' },
    { id: 'invoice.voucher', name: '生成和撤销来源凭证' },
    { id: 'invoice.close', name: '发票月结账' },
    { id: 'invoice.reopen', name: '发票月反结账' },
    { id: 'invoice.settings', name: '配置发票科目映射' },
    { id: 'invoice.export', name: '导出打印发票' },
  ],
  menu: [
    { group: 'invoice', title: '进项发票', path: '/input', permission: 'invoice.view' },
    { group: 'invoice', title: '销项发票', path: '/output', permission: 'invoice.view' },
    { group: 'invoice', title: '发票处理', path: '/process', permission: 'invoice.view' },
    { group: 'invoice', title: '增值税比对', path: '/vat', permission: 'invoice.view' },
    { group: 'invoice', title: '发票参数设置', path: '/settings', permission: 'invoice.settings' },
    { group: 'invoice', title: '发票汇总', path: '/summary', permission: 'invoice.view' },
    { group: 'invoice', title: '发票结账', path: '/periods', permission: 'invoice.view' },
  ],
  sources: [{ type: 'generation', name: '发票制证批次', path: '/process?generationId={id}' }],
});
