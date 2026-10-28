import { periodOfDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { ListEditSchema } from '../shared';
import type { FixedAssetsTables } from './migrations';
import { assetService, fail } from './service';

export async function saveListEdits(
  svc: CoreServices,
  rows: { id: number; revision: number; changes: z.input<typeof ListEditSchema> }[],
) {
  svc.permissions.require('fixed-assets.edit');
  return svc.tx(async (ts) => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (ids.has(row.id)) fail('LIST_DUPLICATE', '同一资产不能在列表中重复保存');
      ids.add(row.id);
      const changes = ListEditSchema.parse(row.changes),
        c = await assetService(ts).assertUnlockedInternal(row.id);
      if (c.revision !== row.revision)
        fail('STALE', `${c.code} 已被其他操作修改`, '刷新列表后重新编辑；本次修改尚未保存');
      if (c.disposal_date) fail('DISPOSED', `${c.code} 已注销，不能编辑列表`);
      await ts.periods.assertWritable({
        period: Math.max((await ts.book.info()).startPeriod, periodOfDate(c.use_date)),
        mode: 'business',
        action: '保存资产列表',
      });
      await ts.db
        .withTables<FixedAssetsTables>()
        .updateTable('fixed_assets_card')
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.model !== undefined ? { model: changes.model } : {}),
          ...(changes.unit !== undefined ? { unit: changes.unit } : {}),
          ...(changes.reference !== undefined ? { reference: changes.reference } : {}),
          ...(changes.manufacturer !== undefined ? { manufacturer: changes.manufacturer } : {}),
          ...(changes.machineCode !== undefined ? { machine_code: changes.machineCode } : {}),
          revision: c.revision + 1,
        })
        .where('id', '=', row.id)
        .execute();
      await assetService(ts).logInternal('list.update', row.id);
    }
    return { changed: rows.length };
  });
}
