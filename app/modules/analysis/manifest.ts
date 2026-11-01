import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'analysis',
  name: '财务分析',
  products: 'all',
  permissions: [
    { id: 'analysis.view', name: '查看科目与自定义分析' },
    { id: 'analysis.aging.view', name: '查看账龄分析' },
    { id: 'analysis.definition.edit', name: '维护分析定义与结果' },
    { id: 'analysis.export', name: '导出及打印分析' },
    { id: 'analysis.contract.view', name: '查看合同档案与账款' },
    { id: 'analysis.contract.edit', name: '维护合同档案' },
    { id: 'analysis.contract.review', name: '审核合同' },
    { id: 'analysis.contract.link', name: '关联合同收付款分录' },
  ],
  menu: [
    { group: 'analysis', title: '科目年度 / 月度分析', path: '/', permission: 'analysis.view' },
    { group: 'analysis', title: '自定义分析表', path: '/custom', permission: 'analysis.view' },
    { group: 'analysis', title: '已保存分析结果', path: '/results', permission: 'analysis.view' },
    { group: 'analysis', title: '账龄分析', path: '/aging', permission: 'analysis.aging.view' },
    {
      group: 'analysis',
      title: '合同档案管理',
      path: '/contracts',
      permission: 'analysis.contract.view',
    },
    {
      group: 'analysis',
      title: '合同账款查询',
      path: '/contract-balances',
      permission: 'analysis.contract.view',
    },
  ],
});
