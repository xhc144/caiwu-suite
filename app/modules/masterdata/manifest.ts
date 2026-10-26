import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'masterdata',
  name: '基础档案',
  products: 'all',
  permissions: [
    { id: 'masterdata.view', name: '查看基础档案' },
    { id: 'masterdata.accounts.edit', name: '维护科目' },
    { id: 'masterdata.dimensions.edit', name: '维护辅助档案' },
    { id: 'masterdata.reference.edit', name: '维护参考档案' },
    { id: 'masterdata.import', name: '导入基础档案' },
  ],
  menu: [
    {
      group: 'master',
      title: '科目维护',
      path: '/accounts',
      permission: 'masterdata.view',
      keywords: ['kmwh'],
    },
    {
      group: 'master',
      title: '辅助档案',
      path: '/dimensions',
      permission: 'masterdata.view',
      keywords: ['项目', '客供', '部门', '人员', '现金流量'],
    },
    {
      group: 'master',
      title: '凭证类型、结算、外币与摘要',
      path: '/reference',
      permission: 'masterdata.view',
    },
  ],
});
