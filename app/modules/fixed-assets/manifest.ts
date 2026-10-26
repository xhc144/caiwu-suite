import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'fixed-assets',
  name: '固定资产',
  products: ['minfei', 'chengben'],
  permissions: [
    { id: 'fixed-assets.view', name: '查看固定资产' },
    { id: 'fixed-assets.edit', name: '编辑固定资产及档案' },
    { id: 'fixed-assets.depreciate', name: '计提折旧' },
    { id: 'fixed-assets.cancel', name: '取消折旧' },
    { id: 'fixed-assets.voucher', name: '生成及删除资产凭证' },
    { id: 'fixed-assets.settings', name: '资产凭证设置' },
    { id: 'fixed-assets.import', name: '导入期初卡片' },
  ],
  menu: [
    { group: 'asset', title: '固定资产台账', path: '/cards', permission: 'fixed-assets.view' },
    { group: 'asset', title: '资产基础档案', path: '/masters', permission: 'fixed-assets.view' },
    {
      group: 'asset',
      title: '计提与取消折旧',
      path: '/depreciation',
      permission: 'fixed-assets.view',
    },
    { group: 'asset', title: '折旧查询与分布', path: '/queries', permission: 'fixed-assets.view' },
    { group: 'asset', title: '资产报表与标签', path: '/reports', permission: 'fixed-assets.view' },
    {
      group: 'asset',
      title: '期初导入与开通',
      path: '/opening',
      permission: 'fixed-assets.import',
    },
    { group: 'asset', title: '统一置数', path: '/batch', permission: 'fixed-assets.edit' },
    {
      group: 'asset',
      title: '资产凭证设置',
      path: '/settings',
      permission: 'fixed-assets.settings',
    },
  ],
  sources: [
    { type: 'depreciation', name: '折旧批次', path: '/depreciation?id={id}' },
    { type: 'disposal', name: '资产清理', path: '/cards?id={id}&includeDisposed=true' },
  ],
});
