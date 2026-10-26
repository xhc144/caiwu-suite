import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'opening',
  name: '期初余额',
  products: 'all',
  permissions: [
    { id: 'opening.view', name: '查看期初余额' },
    { id: 'opening.edit', name: '编辑期初余额' },
    { id: 'opening.import', name: '导入期初余额' },
    { id: 'opening.lock', name: '锁定及解锁年度期初' },
  ],
  menu: [
    { group: 'master', title: '期初余额', path: '/', permission: 'opening.view' },
    {
      group: 'master',
      title: '项目期初录入',
      path: '/?dimension=project',
      permission: 'opening.view',
    },
    {
      group: 'master',
      title: '客供期初录入',
      path: '/?dimension=partner',
      permission: 'opening.view',
    },
    {
      group: 'master',
      title: '部门期初录入',
      path: '/?dimension=department',
      permission: 'opening.view',
    },
    {
      group: 'master',
      title: '个人期初录入',
      path: '/?dimension=person',
      permission: 'opening.view',
    },
  ],
});
