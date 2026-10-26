import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'report-engine',
  name: '报表管理',
  description: '定义单元格报表，从真实总账生成并保存期间结果。',
  products: 'all',
  permissions: [
    { id: 'report-engine.view', name: '查看报表' },
    { id: 'report-engine.edit', name: '编辑报表定义' },
    { id: 'report-engine.generate', name: '生成报表' },
    { id: 'report-engine.export', name: '导出与打印报表' },
  ],
  menu: [
    {
      group: 'report',
      title: '报表管理',
      path: '/',
      permission: 'report-engine.view',
      keywords: ['报表', 'bb'],
    },
  ],
});
