import { BusinessError, nextPeriod, periodOfDate, sumCents } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  CalculationSchema,
  CancelWorksheetSchema,
  ReportSchema,
  SaveWorksheetSchema,
  type CalculationInput,
  type CalculationResult,
  type ProfitLine,
} from '../shared';
import type { CostingTables } from './migrations';
import { inventoryReader, officialCost, readInventory } from './inventory-read';
import { calculate } from './calculation';
import { fail, integer, quantity } from './math';

export function sharedContractRequired(): never {
  throw new BusinessError({
    code: 'COSTING_SHARED_CONTRACT_REQUIRED',
    message: '正式成本核算和出入库凭证尚未开放，不能提交',
    hint: '当前可保存成本试算和查看凭证预览，正式功能开放后再核算入账',
    details: {
      required: [
        'inventory.snapshot',
        'inventory.commitCosting',
        'inventory.cancelCosting',
        'inventory.lockVoucherSource',
        'inventory.releaseVoucherSource',
      ],
    },
  });
}

export function costingService(svc: CoreServices) {
  const db = svc.db.withTables<CostingTables>();
  const self = {
    async context() {
      svc.permissions.require('costing.view');
      const inventory = await inventoryReader(svc);
      return {
        currentPeriod: (await svc.periods.current())?.period ?? (await svc.book.info()).startPeriod,
        warehouses: await inventory
          .selectFrom('inventory_warehouse')
          .select(['id', 'code', 'name'])
          .orderBy('code')
          .execute(),
        canCommit: false as const,
        reason: '正式成本核算尚未开放',
      };
    },
    async preview(raw: CalculationInput): Promise<CalculationResult> {
      svc.permissions.require('costing.view');
      const input = CalculationSchema.parse(raw);
      return svc.tx(async (t) =>
        calculate(await readInventory(t, input.period), input.period, input.adjustZeroQuantity),
      );
    },
    async worksheets() {
      svc.permissions.require('costing.view');
      return db
        .selectFrom('costing_worksheet')
        .select(['id', 'period', 'status', 'fingerprint', 'revision', 'created_at', 'cancelled_at'])
        .orderBy('id', 'desc')
        .execute();
    },
    async worksheet(id: number) {
      svc.permissions.require('costing.view');
      return svc.tx(async (t) => {
        const row = await t.db
          .withTables<CostingTables>()
          .selectFrom('costing_worksheet')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) fail('NOT_FOUND', '成本试算不存在', '请刷新试算列表');
        const source = await readInventory(t, row.period);
        return {
          ...row,
          result: JSON.parse(row.result_json) as CalculationResult,
          stale: source.fingerprint !== row.fingerprint,
        };
      });
    },
    async saveWorksheet(raw: z.input<typeof SaveWorksheetSchema>) {
      svc.permissions.require('costing.worksheet');
      const input = SaveWorksheetSchema.parse(raw);
      return svc.tx(async (t) => {
        const tdb = t.db.withTables<CostingTables>();
        await t.periods.assertOpen(input.period, '保存成本试算');
        const snapshot = await readInventory(t, input.period);
        if (snapshot.fingerprint !== input.fingerprint)
          fail('STALE', '来源数据已变化，不能保存旧试算', '请重新试算并核对结果');
        if (
          await tdb
            .selectFrom('costing_worksheet')
            .select('id')
            .where('period', '=', input.period)
            .where('status', '=', 'preview')
            .executeTakeFirst()
        )
          fail('DUPLICATE', '本月已有有效试算', '先取消旧试算，再保存本次结果');
        const result = calculate(snapshot, input.period, input.adjustZeroQuantity);
        if (!result.rows.length)
          fail('EMPTY', '本月没有可试算的库存数据', '先录入期初或出入库单据');
        const now = t.ctx.now().toISOString();
        const row = await tdb
          .insertInto('costing_worksheet')
          .values({
            period: input.period,
            fingerprint: input.fingerprint,
            adjust_zero_quantity: Number(input.adjustZeroQuantity),
            status: 'preview',
            result_json: JSON.stringify(result),
            revision: 1,
            created_by: t.user.id,
            created_at: now,
            cancelled_at: null,
          })
          .returning(['id', 'revision'])
          .executeTakeFirstOrThrow();
        await t.log.write({
          action: 'costing.worksheet.save',
          summary: `保存 ${input.period} 月末加权成本试算（尚未正式核算）`,
          targetType: 'costing_worksheet',
          targetId: row.id,
        });
        return row;
      });
    },
    async cancelWorksheet(raw: z.input<typeof CancelWorksheetSchema>) {
      svc.permissions.require('costing.worksheet');
      const input = CancelWorksheetSchema.parse(raw);
      if (!input.confirmed)
        fail('CONFIRM', '取消试算需要确认', '确认后重新操作；库存和会计凭证不受影响');
      return svc.tx(async (t) => {
        const tdb = t.db.withTables<CostingTables>();
        const row = await tdb
          .selectFrom('costing_worksheet')
          .selectAll()
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (!row) fail('NOT_FOUND', '成本试算不存在');
        if (row.revision !== input.revision)
          fail('REVISION', '试算版本已经变化', '请刷新列表后再操作');
        if (row.status !== 'preview') fail('CANCELLED', '这份试算已经取消');
        await t.periods.assertOpen(row.period, '取消成本试算');
        await tdb
          .updateTable('costing_worksheet')
          .set({
            status: 'cancelled',
            revision: row.revision + 1,
            cancelled_at: t.ctx.now().toISOString(),
          })
          .where('id', '=', row.id)
          .execute();
        await t.log.write({
          action: 'costing.worksheet.cancel',
          summary: `取消 ${row.period} 成本试算`,
          targetType: 'costing_worksheet',
          targetId: row.id,
        });
        return { id: row.id, revision: row.revision + 1 };
      });
    },
    async commit(raw: CalculationInput) {
      svc.permissions.require('costing.calculate');
      const input = CalculationSchema.parse(raw);
      await svc.periods.assertOpen(input.period, '成本核算');
      return sharedContractRequired();
    },
    async cancelCalculation() {
      svc.permissions.require('costing.calculate');
      const start = (await svc.book.info()).startPeriod;
      const snapshot = await svc.tx((t) => readInventory(t, start));
      if (!snapshot.control.cost_period || snapshot.control.cost_period < start)
        fail('INITIAL_PERIOD', '已到初始开账日期，没有可以取消的成本核算');
      await svc.periods.assertOpen(snapshot.control.cost_period, '取消成本核算');
      return sharedContractRequired();
    },
    async profit(raw: z.input<typeof ReportSchema>) {
      svc.permissions.require('costing.view');
      const input = ReportSchema.parse(raw);
      return svc.tx(async (t) => {
        const snapshot = await readInventory(t, periodOfDate(input.to));
        const docs = new Map(snapshot.documents.map((d) => [d.id, d]));
        const rows: ProfitLine[] = [];
        for (const line of snapshot.lines) {
          const doc = docs.get(line.document_id)!;
          const product = snapshot.products.find((p) => p.id === line.product_id)!;
          if (
            doc.kind !== 'issue' ||
            doc.category !== '销售' ||
            doc.date < input.from ||
            doc.date > input.to ||
            (input.warehouseId && doc.warehouse_id !== input.warehouseId) ||
            (input.productFrom && product.code < input.productFrom) ||
            (input.productTo && product.code > input.productTo)
          )
            continue;
          // 只有头、行、全局截止点属于同一正式批次时才使用库存核算金额，试算绝不混入正式利润。
          const cost = officialCost(snapshot, doc, line);
          rows.push({
            id: line.id,
            documentId: doc.id,
            date: doc.date,
            number: doc.number,
            warehouseId: doc.warehouse_id,
            productCode: product.code,
            productName: product.name,
            quantity: quantity(integer(line.quantity_e6)),
            revenueCents: line.net_cents,
            taxCents: line.tax_cents,
            costCents: cost,
            grossProfitCents: cost == null ? null : sumCents([line.net_cents, -cost]),
            costStatus: cost == null ? '待成本核算' : '已核算',
          });
        }
        if (!rows.length)
          fail('EMPTY_REPORT', '该日期范围内没有销售出库记录', '请调整日期、仓库或产品范围');
        const missing = rows.filter((r) => r.costCents == null).length;
        return {
          rows,
          totals: {
            revenueCents: sumCents(rows.map((r) => r.revenueCents)),
            taxCents: sumCents(rows.map((r) => r.taxCents)),
            costCents: missing ? null : sumCents(rows.map((r) => r.costCents)),
            grossProfitCents: missing ? null : sumCents(rows.map((r) => r.grossProfitCents)),
            pendingLines: missing,
          },
          throughPeriod: snapshot.control.cost_period,
          nextCalculationPeriod: snapshot.control.cost_period
            ? nextPeriod(snapshot.control.cost_period)
            : snapshot.startPeriod,
        };
      });
    },
  };
  return self;
}
