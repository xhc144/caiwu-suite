import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'backup',
  name: '备份恢复',
  description: '完整账套备份、可携带包校验、新账套及覆盖恢复',
  products: 'all',
  permissions: [
    { id: 'backup.view', name: '查看备份目录' },
    { id: 'backup.create', name: '创建完整备份' },
    { id: 'backup.verify', name: '校验及上传预览' },
    { id: 'backup.export', name: '下载备份包' },
    { id: 'backup.restore', name: '恢复账套' },
    { id: 'backup.settings', name: '设置自动备份' },
    { id: 'backup.prune', name: '删除备份' },
  ],
  menu: [
    {
      group: 'system',
      title: '备份恢复',
      path: '/',
      permission: 'backup.view',
      keywords: ['数据备份', '数据恢复', '自动备份', '批量引入'],
    },
  ],
});
