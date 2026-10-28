import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'legacy-import',
  name: '原账迁移',
  products: 'all',
  description: '从原版导出的科目、辅助档案、期初和凭证迁移账务数据',
  permissions: [
    { id: 'legacy-import.view', name: '查看原账迁移' },
    { id: 'legacy-import.prepare', name: '上传及预检迁移数据' },
    { id: 'legacy-import.execute', name: '正式导入原账数据' },
  ],
  menu: [
    {
      group: 'system',
      title: '原账迁移',
      path: '/',
      permission: 'legacy-import.view',
      keywords: ['原版导入', '原账', 'Excel', '文本', '迁移'],
    },
  ],
});
