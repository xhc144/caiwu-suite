import { BusinessError, type Account } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  MultiFormatChangeSchema,
  MultiFormatSchema,
  type MultiColumnDefinition,
  type MultiFormat,
} from '../multicolumn';
import type { z } from 'zod';

export function resolveMultiColumns(
  accounts: Account[],
  root: Account,
  definitions: MultiColumnDefinition[],
) {
  const descendants = accounts.filter((a) => a.code.startsWith(root.code));
  return definitions.map((column, i) => {
    const leaves = new Set<number>();
    for (const code of column.accountCodes) {
      const account = descendants.find((a) => a.code === code);
      if (!account)
        throw new BusinessError({
          code: 'LEDGERS_MULTI_COLUMN_ACCOUNT',
          message: `栏目“${column.name}”的科目 ${code} 不在所选科目范围内`,
          hint: '请选择当前上级科目或它的下级科目。',
        });
      for (const leaf of descendants.filter((a) => a.isLeaf && a.code.startsWith(code))) {
        if (leaves.has(leaf.id))
          throw new BusinessError({
            code: 'LEDGERS_MULTI_COLUMN_OVERLAP',
            message: `栏目“${column.name}”的科目集合重复或包含重叠的父子科目`,
            hint: '每栏内只选父科目或其下级科目中的一种；不同栏目可以独立取数。',
          });
        leaves.add(leaf.id);
      }
    }
    return {
      id: -i - 1,
      code: column.accountCodes.join('、'),
      name: column.name,
      mode: column.mode,
      accountCodes: column.accountCodes,
      leaves,
    };
  });
}

export function multiFormatService(svc: CoreServices) {
  const key = (account: string) => `multi.format.${account}`;
  const read = async (account: string): Promise<MultiFormat> =>
    MultiFormatSchema.parse(await svc.settings.get(key(account), { columns: null, revision: 0 }));
  return {
    read,
    async save(raw: z.infer<typeof MultiFormatChangeSchema>) {
      const input = MultiFormatChangeSchema.parse(raw);
      return svc.tx(async (t) => {
        const current = await multiFormatService(t).read(input.account);
        if (!input.confirmed) return current;
        if (current.revision !== input.expectedRevision)
          throw new BusinessError({
            code: 'LEDGERS_FORMAT_STALE',
            message: '多栏账格式已被其他窗口修改',
            hint: '请关闭格式窗口，刷新后重新保存。',
          });
        const accounts = await t.accounts.list();
        const root = accounts.find((a) => a.code === input.account);
        if (!root || root.isLeaf)
          throw new BusinessError({
            code: 'LEDGERS_MULTI_FORMAT_ACCOUNT',
            message: '请选择存在且含下级的上级科目',
            hint: '重新选择科目后保存格式。',
          });
        if (input.columns) resolveMultiColumns(accounts, root, input.columns);
        const next = { columns: input.columns, revision: current.revision + 1 };
        await t.settings.set(key(input.account), next);
        return next;
      });
    },
  };
}
