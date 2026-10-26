import { defineManifest } from '@caiwu/core';

/**
 * 示范模块：一个最小但完整的业务模块，演示所有约定。新模块请复制这个目录改名。
 * 只在开发模式显示（devOnly），不会出现在正式产品里。
 */
export default defineManifest({
  id: 'example',
  name: '示范模块',
  description: '示范记账单：录入一笔费用，一键生成凭证。用来演示模块的写法。',
  products: 'all',
  devOnly: true,
  permissions: [
    { id: 'example.memo.view', name: '查看记账单' },
    { id: 'example.memo.edit', name: '编辑记账单' },
    { id: 'example.memo.voucher', name: '记账单生成凭证' },
  ],
  menu: [
    {
      group: 'dev',
      title: '示范记账单',
      path: '/memos',
      permission: 'example.memo.view',
      shortcut: 'Alt+Shift+M',
      keywords: ['示范', '记账单', 'sfjzd'],
    },
  ],
  sources: [{ type: 'memo', name: '示范记账单', path: '/memos?id={id}' }],
});
