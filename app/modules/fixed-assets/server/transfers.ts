import { periodOfDate, qtyToE6 } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Selectable } from '@caiwu/db';
import type { FixedAssetsTables } from './migrations';
import { assetService, fail } from './service';

export type TransferRow = Selectable<FixedAssetsTables['fixed_assets_transfer']>;
export type TransferInput = {
  id: number;
  revision: number;
  date: string;
  departmentId: number;
  purposeId: number;
  statusId: number;
  note: string;
  confirm: boolean;
  installation?: string;
  custodian?: string;
  quantity?: string;
};

/** Current card holds the latest allocation; undo future events to obtain a historical allocation. */
export function allocationAt<
  T extends {
    department_id: number;
    purpose_id: number;
    status_id: number;
    installation?: string;
    custodian?: string;
    quantity_e6?: number;
  },
>(card: T, transfers: readonly TransferRow[], date: string) {
  const result = { ...card };
  for (const t of [...transfers].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)) {
    if (t.date <= date) continue;
    result.department_id = t.from_department_id;
    result.purpose_id = t.from_purpose_id;
    result.status_id = t.from_status_id;
    result.installation = t.from_installation;
    result.custodian = t.from_custodian;
    result.quantity_e6 = t.from_quantity_e6;
  }
  return result;
}

export function transferService(svc: CoreServices) {
  const db = svc.db.withTables<FixedAssetsTables>();
  const records = (id: number) =>
    db
      .selectFrom('fixed_assets_transfer')
      .selectAll()
      .where('asset_id', '=', id)
      .orderBy('date')
      .orderBy('id')
      .execute();
  const writable = async (id: number, date: string) => {
    const assets = assetService(svc);
    const c = await assets.cardInternal(id);
    if (c.disposal_date) fail('DISPOSED', '已注销资产不能转移', '请先逆序撤销注销');
    if (date < c.use_date) fail('TRANSFER_DATE', '转移日期不能早于使用日期');
    await svc.periods.assertWritable({
      period: periodOfDate(date),
      mode: 'business',
      action: '资产转移',
    });
    const batch = await db
      .selectFrom('fixed_assets_line as l')
      .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
      .select('b.period')
      .where('l.asset_id', '=', id)
      .where('b.period', '>=', periodOfDate(date))
      .executeTakeFirst();
    if (batch)
      fail(
        'TRANSFER_HISTORY',
        `${c.code} 已计提 ${batch.period} 月及以后折旧`,
        '请先逆序取消受影响月份折旧，再办理转移',
      );
    const change = await db
      .selectFrom('fixed_assets_adjustment')
      .select('date')
      .where('asset_id', '=', id)
      .where('date', '>', date)
      .executeTakeFirst();
    if (change) fail('TRANSFER_ORDER', '已有日期更晚的原值调整', '请按日期逆序撤销后续业务');
    return c;
  };
  return {
    async list(id: number) {
      svc.permissions.require('fixed-assets.view');
      return records(id);
    },
    async save(input: TransferInput) {
      svc.permissions.require('fixed-assets.edit');
      return svc.tx(async (ts) => {
        const tdb = ts.db.withTables<FixedAssetsTables>();
        const service = transferService(ts);
        const c = await service.writable(input.id, input.date);
        if (!input.confirm) fail('CONFIRM', '资产转移须核对转前、转后资料并确认');
        if (c.revision !== input.revision)
          fail('STALE', '资产资料已改变', '刷新卡片后重新办理转移');
        const last = (await service.records(input.id)).at(-1);
        if (last && input.date < last.date) fail('TRANSFER_ORDER', '转移日期不能早于最后一次转移');
        const department = await ts.dimensions.get(input.departmentId);
        if (
          !department ||
          department.typeId !== 'department' ||
          !department.isLeaf ||
          (department.disabled && department.id !== c.department_id)
        )
          fail(
            'DEPARTMENT',
            '请选择启用的末级部门',
            '请在基础档案维护部门',
            '/m/fixed-assets/masters',
          );
        const assets = assetService(ts);
        await assets.masterInternal(input.purposeId, 'purpose');
        await assets.masterInternal(input.statusId, 'status');
        if (
          input.departmentId === c.department_id &&
          input.purposeId === c.purpose_id &&
          input.statusId === c.status_id &&
          (input.installation ?? c.installation) === c.installation &&
          (input.custodian ?? c.custodian) === c.custodian &&
          (input.quantity === undefined ? c.quantity_e6 : qtyToE6(input.quantity)) === c.quantity_e6
        )
          fail('TRANSFER_UNCHANGED', '部门、用途和状态均未改变');
        const record = await tdb
          .insertInto('fixed_assets_transfer')
          .values({
            asset_id: c.id,
            date: input.date,
            from_department_id: c.department_id,
            to_department_id: input.departmentId,
            from_purpose_id: c.purpose_id,
            to_purpose_id: input.purposeId,
            from_status_id: c.status_id,
            to_status_id: input.statusId,
            from_installation: c.installation,
            to_installation: input.installation ?? c.installation,
            from_custodian: c.custodian,
            to_custodian: input.custodian ?? c.custodian,
            from_quantity_e6: c.quantity_e6,
            to_quantity_e6: input.quantity === undefined ? c.quantity_e6 : qtyToE6(input.quantity),
            note: input.note,
            operator: ts.ctx.user.name,
            created_at: ts.ctx.now().toISOString(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tdb
          .updateTable('fixed_assets_card')
          .set({
            department_id: input.departmentId,
            purpose_id: input.purposeId,
            status_id: input.statusId,
            installation: input.installation ?? c.installation,
            custodian: input.custodian ?? c.custodian,
            quantity_e6: input.quantity === undefined ? c.quantity_e6 : qtyToE6(input.quantity),
            revision: c.revision + 1,
          })
          .where('id', '=', c.id)
          .execute();
        await assets.logInternal('transfer', record.id);
        return record.id;
      });
    },
    async undo(id: number, confirm: boolean) {
      svc.permissions.require('fixed-assets.edit');
      return svc.tx(async (ts) => {
        const tdb = ts.db.withTables<FixedAssetsTables>();
        const t = await tdb
          .selectFrom('fixed_assets_transfer')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!t) fail('TRANSFER_MISSING', '转移记录不存在或已撤销', '刷新转移记录');
        if (!confirm) fail('CONFIRM', '撤销资产转移需要确认');
        const service = transferService(ts);
        if ((await service.records(t.asset_id)).at(-1)?.id !== t.id)
          fail('TRANSFER_ORDER', '只能撤销最后一次资产转移', '请按日期逆序撤销');
        const c = await service.writable(t.asset_id, t.date);
        if (
          c.department_id !== t.to_department_id ||
          c.purpose_id !== t.to_purpose_id ||
          c.status_id !== t.to_status_id ||
          c.installation !== t.to_installation ||
          c.custodian !== t.to_custodian ||
          c.quantity_e6 !== t.to_quantity_e6
        )
          fail('TRANSFER_CHAIN', '当前卡片与转移记录不一致', '请核对卡片和历史，不能直接覆盖');
        await tdb
          .updateTable('fixed_assets_card')
          .set({
            department_id: t.from_department_id,
            purpose_id: t.from_purpose_id,
            status_id: t.from_status_id,
            installation: t.from_installation,
            custodian: t.from_custodian,
            quantity_e6: t.from_quantity_e6,
            revision: c.revision + 1,
          })
          .where('id', '=', c.id)
          .execute();
        await tdb.deleteFrom('fixed_assets_transfer').where('id', '=', t.id).execute();
        await assetService(ts).logInternal('transfer.undo', t.id);
      });
    },
    writable,
    records,
  };
}
