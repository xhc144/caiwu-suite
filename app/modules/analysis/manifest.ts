import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'analysis',
  name: '财务分析',
  products: 'all',
  permissions: [
    { id: 'analysis.view', name: '查看科目分析' },
    { id: 'analysis.aging.view', name: '查看账龄分析' },
    { id: 'analysis.definition.edit', name: '保存分析配置' },
    { id: 'analysis.export', name: '导出及打印分析' },
  ],
  menu: [
    { group: 'analysis', title: '科目年度 / 月度分析', path: '/', permission: 'analysis.view' },
    { group: 'analysis', title: '账龄分析', path: '/aging', permission: 'analysis.aging.view' },
  ],
});
