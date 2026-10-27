import { defineManifest } from '@caiwu/core';

export default defineManifest({
  id: 'voucher-book',
  name: '凭证管理',
  products: 'all',
  permissions: [
    { id: 'voucher-book.view', name: '查看凭证' },
    { id: 'voucher-book.audit', name: '审核凭证' },
    { id: 'voucher-book.unaudit', name: '取消审核' },
    { id: 'voucher-book.delete', name: '删除凭证' },
    { id: 'voucher-book.void', name: '作废与取消作废' },
    { id: 'voucher-book.insert', name: '插入凭证' },
    { id: 'voucher-book.copy', name: '复制凭证' },
    { id: 'voucher-book.reverse', name: '红字冲销' },
    { id: 'voucher-book.renumber', name: '整理编号' },
    { id: 'voucher-book.modify', name: '批量修改凭证日期或类型' },
    { id: 'voucher-book.import', name: '导入凭证' },
    { id: 'voucher-book.overwrite', name: '导入覆盖待审核凭证' },
    { id: 'voucher-book.export', name: '导出凭证' },
  ],
  menu: [
    { group: 'voucher', title: '凭证序时簿', path: '/', permission: 'voucher-book.view' },
    { group: 'voucher', title: '凭证科目汇总', path: '/summary', permission: 'voucher-book.view' },
    { group: 'voucher', title: '丁字帐户', path: '/t-account', permission: 'voucher-book.view' },
  ],
  sources: [{ type: 'reversal', name: '红字冲销', path: '/?id={id}' }],
});
