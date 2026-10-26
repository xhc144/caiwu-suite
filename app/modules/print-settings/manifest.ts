import { defineManifest } from '@caiwu/core';
export default defineManifest({
  id: 'print-settings',
  name: '打印与导出',
  products: 'all',
  permissions: [
    { id: 'print-settings.view', name: '查看打印设置' },
    { id: 'print-settings.settings.edit', name: '修改打印设置' },
    { id: 'print-settings.voucher.print', name: '打印凭证' },
    { id: 'print-settings.ledger.print', name: '打印账簿' },
    { id: 'print-settings.format.edit', name: '编辑特殊打印格式' },
    { id: 'print-settings.export', name: '导出打印 PDF' },
  ],
  menu: [
    {
      group: 'system',
      title: '打印与导出',
      path: '/preview',
      permission: 'print-settings.view',
      keywords: ['打印', 'PDF', '格式'],
    },
  ],
});
