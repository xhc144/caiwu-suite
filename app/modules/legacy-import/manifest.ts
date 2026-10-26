import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'legacy-import',
  name: '标准化账务导入',
  description: '向新空账导入经过核对的 Excel、CSV 或 TSV；不支持原版 bak。',
  products: 'all',
  permissions: [
    { id: 'legacy-import.view', name: '查看导入与来源' },
    { id: 'legacy-import.prepare', name: '导入预检和映射' },
    { id: 'legacy-import.execute', name: '执行新空账导入' },
  ],
  menu: [
    {
      group: 'system',
      title: '标准化账务导入',
      path: '/',
      permission: 'legacy-import.view',
      keywords: ['原版', '导入', 'Excel', 'CSV'],
    },
  ],
  sources: [{ type: 'batch', name: '导入来源', path: '/?id={id}' }],
});
