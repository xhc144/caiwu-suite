import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'period-close',
  name: '过账与结账',
  products: 'all',
  permissions: [
    { id: 'period-close.view', name: '查看期间检查' },
    { id: 'period-close.post', name: '凭证过账' },
    { id: 'period-close.unpost', name: '凭证反过账' },
    { id: 'period-close.transfer.edit', name: '维护结转类型' },
    { id: 'period-close.transfer.generate', name: '生成结转凭证' },
    { id: 'period-close.close', name: '结账与编号整理' },
    { id: 'period-close.reopen', name: '反结账' },
    { id: 'period-close.year-end', name: '年结' },
  ],
  menu: [{ group: 'period', title: '过账与结账', path: '/', permission: 'period-close.view' }],
  sources: [{ type: 'closing', name: '月度结转', path: '/?source={id}' }],
});
