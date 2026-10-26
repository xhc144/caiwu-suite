import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'workbench',
  name: '工作台',
  products: 'all',
  entryPages: ['home'],
  permissions: [
    { id: 'workbench.overview.view', name: '查看工作台统计' },
    { id: 'workbench.search', name: '使用全局实体搜索' },
    { id: 'workbench.settings', name: '保存工作台个人偏好' },
    { id: 'workbench.product.switch', name: '切换账套产品形态' },
  ],
  menu: [
    { group: 'system', title: '工作台', path: '/', keywords: ['首页', 'gzt'] },
    { group: 'system', title: '全局搜索', path: '/search', keywords: ['查找', 'qjss'] },
    { group: 'system', title: '工作台设置', path: '/settings', keywords: ['产品形态', 'sz'] },
    { group: 'system', title: '帮助与关于', path: '/help', keywords: ['使用引导', 'bz'] },
  ],
});
