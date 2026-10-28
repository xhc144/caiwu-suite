import { Decimal, periodOfDate, sumCents, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  ProductionSchema,
  SaveProductionSchema,
  CancelProductionSchema,
  ProductionDraftSchema,
} from '../production-shared';
import { allocateCents } from './allocation';
import { accountBalances, requireCostAccount, stockLine } from './cost-accounts';
import { digest, quantityE6 } from './inventory-read';
import { fail } from './math';
import type { CostingTables } from './migrations';
import { requireCostingOwner } from './owner';

async function build(svc: CoreServices, input: z.infer<typeof ProductionSchema>) {
  const period = periodOfDate(input.date);
  await svc.periods.assertWritable({ period, action: '归集完工产品成本' });
  const snapshot = await svc.inventory.snapshot(period);
  if (snapshot.control.costPeriod != null && period <= snapshot.control.costPeriod)
    fail(
      'PRODUCTION_LOCK',
      '该月份已完成库存成本核算，不能增加完工入库',
      '请先取消最后月份成本核算',
    );
  const warehouse = snapshot.warehouses.find((w) => w.id === input.warehouseId && !w.disabled);
  if (!warehouse) fail('WAREHOUSE', '完工入库仓库不存在或已停用');
  const ids = [input.materialAccountId, input.laborAccountId, input.overheadAccountId];
  if (new Set(ids).size !== 3) fail('ACCOUNT', '材料、人工与制造费用必须分别选择不同明细科目');
  for (const id of ids) {
    const account = await requireCostAccount(svc, id, '生产成本');
    if (account.categoryId !== 'cost') fail('ACCOUNT', '生产费用归集必须使用成本类明细科目');
  }
  const balances = await accountBalances(svc, ids, period);
  if (balances.some((r) => r.closing < 0))
    fail(
      'PRODUCTION_BALANCE',
      '生产费用存在贷方余额，不能按正费用分摊',
      '请先核对生产成本及辅助核算余额',
    );
  const totals = ids.map((id) =>
    sumCents(balances.filter((b) => b.accountId === id).map((b) => b.closing)),
  );
  if (!totals.some((total) => total > 0)) fail('EMPTY', '材料、人工和制造费用没有可分配余额');
  if (new Set(input.rows.map((r) => r.productId)).size !== input.rows.length)
    fail('PRODUCT', '同一完工产品只能录入一行', '请合并相同产品的完工数量');
  const products = input.rows.map((row) => {
    const product = snapshot.products.find((p) => p.id === row.productId && !p.disabled);
    if (!product) fail('PRODUCT', '完工产品不存在或已停用');
    if (new Decimal(row.quantity).lte(0)) fail('QUANTITY', '完工数量必须大于零');
    // 原版接近零的系数恢复为 1，预览明确列出最终采用值。
    const requestedFactor = row.factor ?? product.allocationFactor;
    const factor = new Decimal(requestedFactor).lt('0.0001') ? '1' : requestedFactor;
    return {
      ...row,
      factor,
      productCode: product.code,
      productName: product.name,
      unit: product.unit,
      inventoryAccountId: product.inventoryAccountId,
    };
  });
  const weights = products.map((r) =>
    (BigInt(quantityE6(r.quantity)) * BigInt(quantityE6(r.factor))).toString(),
  );
  const material = allocateCents(totals[0]!, weights);
  const labor = allocateCents(totals[1]!, weights);
  const overhead = allocateCents(totals[2]!, weights);
  const rows = products.map((p, i) => {
    const totalCents = sumCents([material[i], labor[i], overhead[i]]);
    const unitPrice = new Decimal(totalCents).div(100).div(p.quantity).toFixed(6);
    const storedCents = new Decimal(p.quantity)
      .mul(unitPrice)
      .mul(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    if (storedCents !== totalCents || new Decimal(unitPrice).gte('1000000000'))
      fail(
        'PRODUCTION_PRECISION',
        `产品 ${p.productCode} 的分摊总额无法按现有单价精度准确入库`,
        '请调整完工数量或分批归集；本次没有保存任何数据',
      );
    return {
      ...p,
      materialCents: material[i]!,
      laborCents: labor[i]!,
      overheadCents: overhead[i]!,
      totalCents,
      unitPrice,
    };
  });
  const lines: VoucherLineInput[] = [];
  for (const row of rows) {
    const line = await stockLine(
      svc,
      row.inventoryAccountId,
      row.totalCents,
      row.quantity,
      row.unit,
    );
    if (line.debit || line.quantity)
      lines.push({ ...line, summary: `完工入库 ${row.productCode}` });
  }
  for (const balance of balances)
    if (balance.closing)
      lines.push({
        accountId: balance.accountId,
        dimensions: balance.dimensions,
        credit: balance.closing,
        summary: '分配完工产品生产成本',
      });
  if (lines.length > 999)
    fail('LINES', '分摊的产品及辅助项过多，超过单张凭证容量', '请按仓库或产品分批归集');
  return {
    period,
    warehouseName: warehouse.name,
    rows,
    materialCents: totals[0]!,
    laborCents: totals[1]!,
    overheadCents: totals[2]!,
    totalCents: sumCents(totals),
    lines,
    fingerprint: digest({ input, inventory: snapshot.fingerprint, balances, rows, lines }),
  };
}

export async function productionContext(svc: CoreServices) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.view');
  const period = (await svc.periods.current())?.period ?? (await svc.book.info()).startPeriod;
  const snapshot = await svc.inventory.snapshot(period);
  return {
    period,
    products: snapshot.products.filter((p) => !p.disabled),
    warehouses: snapshot.warehouses.filter((w) => !w.disabled),
    saved: await svc.db
      .withTables<CostingTables>()
      .selectFrom('costing_production')
      .selectAll()
      .orderBy('id', 'desc')
      .execute(),
  };
}

export async function productionDraft(svc: CoreServices) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.calculate');
  const saved = await svc.settings.get(`production-draft:${svc.user.id}`, null);
  const parsed = ProductionDraftSchema.safeParse(saved);
  return parsed.success ? parsed.data : null;
}
export async function saveProductionDraft(
  svc: CoreServices,
  raw: z.input<typeof ProductionDraftSchema>,
) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.calculate');
  const input = ProductionDraftSchema.parse(raw);
  await svc.tx((t) => t.settings.set(`production-draft:${t.user.id}`, input));
  return input;
}

export async function previewProduction(svc: CoreServices, raw: z.input<typeof ProductionSchema>) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.calculate');
  const input = ProductionSchema.parse(raw);
  return svc.tx((t) => build(t, input));
}

export async function saveProduction(svc: CoreServices, raw: z.input<typeof SaveProductionSchema>) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.calculate');
  svc.permissions.require('costing.voucher');
  svc.permissions.require('inventory.edit');
  const input = SaveProductionSchema.parse(raw);
  if (!input.confirmed) fail('CONFIRM', '完工入库及凭证需要核对后确认');
  return svc.tx(async (t) => {
    const db = t.db.withTables<CostingTables>();
    const requestHash = digest(input);
    const repeated = await db
      .selectFrom('costing_production')
      .selectAll()
      .where('request_key', '=', input.requestKey)
      .executeTakeFirst();
    if (repeated) {
      if (
        repeated.request_hash !== requestHash ||
        repeated.created_by !== t.user.id ||
        repeated.status !== 'saved'
      )
        fail('REQUEST', '同一完工入库请求的内容、操作员或状态已变化');
      return repeated;
    }
    const result = await build(t, ProductionSchema.parse(input));
    if (result.fingerprint !== input.fingerprint)
      fail('STALE', '生产费用、产品或库存已变化，请重新预览');
    const record = await db
      .insertInto('costing_production')
      .values({
        period: result.period,
        warehouse_id: input.warehouseId,
        date: input.date,
        request_key: input.requestKey,
        request_hash: requestHash,
        fingerprint: result.fingerprint,
        result_json: JSON.stringify(result),
        document_id: null,
        voucher_id: null,
        status: 'saved',
        revision: 1,
        created_by: t.user.id,
        created_at: t.ctx.now().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const document = await t.inventory.with((inventory) =>
      inventory.saveDocument({
        requestKey: `production:${digest(input.requestKey)}`,
        kind: 'receipt',
        warehouseId: input.warehouseId,
        number: `完工-${record.id}`,
        date: input.date,
        category: '其他入库',
        accountId: input.materialAccountId,
        taxRate: '0',
        summary: '完工产品成本分配',
        lines: result.rows.map((r) => ({
          productCode: r.productCode,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
        })),
      }),
    );
    const actual = await t.inventory.snapshot(result.period);
    const stored = actual.movements
      .filter((l) => l.documentId === document.id)
      .sort((a, b) => a.position - b.position);
    if (
      stored.length !== result.rows.length ||
      stored.some((l, i) => l.netCents !== result.rows[i]!.totalCents)
    )
      fail(
        'PRODUCTION_PRECISION',
        '完工入库金额与费用分摊不一致，已取消整笔保存',
        '请核对数量、单价精度后重新预览',
      );
    const voucher = await t.vouchers.create({
      voucherTypeId: input.voucherTypeId,
      number: input.number,
      date: input.date,
      source: { type: 'receipt', id: String(document.id) },
      lines: result.lines,
    });
    await t.inventory.with((inventory) =>
      inventory.lockVoucherSource({
        bookId: actual.bookId,
        documentId: document.id,
        expectedRevision: document.revision,
        purpose: 'receipt',
        voucherId: voucher.id,
      }),
    );
    await db
      .updateTable('costing_production')
      .set({ document_id: document.id, voucher_id: voucher.id })
      .where('id', '=', record.id)
      .execute();
    await t.settings.set(`production-draft:${t.user.id}`, null);
    await t.log.write({
      action: 'costing.production.save',
      summary: `保存完工入库 ${record.id} 及生产费用分配凭证 ${voucher.displayNo}`,
      targetId: record.id,
    });
    return { ...record, document_id: document.id, voucher_id: voucher.id };
  });
}

async function cancelState(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<CostingTables>()
    .selectFrom('costing_production')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row || row.status !== 'saved' || !row.document_id || !row.voucher_id)
    fail('PRODUCTION', '完工入库记录不存在或已经取消');
  await svc.periods.assertWritable({ period: row.period, action: '取消完工入库' });
  const snapshot = await svc.inventory.snapshot(row.period);
  const document = snapshot.documents.find((d) => d.id === row.document_id);
  if (!document || document.calculationStatus === 'calculated' || document.auditedBy)
    fail(
      'PRODUCTION_LOCK',
      '完工入库已审核、已核算或不存在，不能取消',
      '请先撤销单据审核和本月成本核算',
    );
  const voucher = await svc.vouchers.get(row.voucher_id);
  if (!voucher || voucher.status !== 'pending')
    fail('VOUCHER_LOCK', '完工凭证已审核、过账或不存在，不能取消');
  return { row, snapshot, document };
}
export async function previewCancelProduction(svc: CoreServices, id: number) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.calculate');
  svc.permissions.require('costing.voucher');
  return svc.tx(async (t) => {
    const { row } = await cancelState(t, id);
    return { id, revision: row.revision, plan: await t.vouchers.previewDelete([row.voucher_id!]) };
  });
}
export async function cancelProduction(
  svc: CoreServices,
  raw: z.input<typeof CancelProductionSchema>,
) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.calculate');
  svc.permissions.require('costing.voucher');
  svc.permissions.require('inventory.edit');
  const input = CancelProductionSchema.parse(raw);
  if (!input.confirmed || !input.voucherDeletion?.confirmed)
    fail('CONFIRM', '取消完工入库需要确认凭证编号影响');
  return svc.tx(async (t) => {
    const { row, snapshot, document } = await cancelState(t, input.id);
    if (row.revision !== input.revision) fail('REVISION', '完工入库版本已变化，请刷新后再操作');
    const deletion = input.voucherDeletion!;
    if (deletion.plan.ids.length !== 1 || deletion.plan.ids[0] !== row.voucher_id)
      fail('STALE', '删除预览与完工凭证不一致');
    await t.inventory.with(async (inventory) => {
      const released = await inventory.releaseVoucherSource({
        bookId: snapshot.bookId,
        documentId: document.id,
        expectedRevision: document.revision,
        purpose: 'receipt',
        voucherId: row.voucher_id!,
        voucherDeletion: deletion,
      });
      await inventory.removeDocument({
        id: document.id,
        revision: released.revision,
        confirmed: true,
      });
    });
    await t.db
      .withTables<CostingTables>()
      .updateTable('costing_production')
      .set({ status: 'cancelled', voucher_id: null, revision: row.revision + 1 })
      .where('id', '=', row.id)
      .execute();
    await t.log.write({
      action: 'costing.production.cancel',
      summary: `取消完工入库 ${row.id}`,
      targetId: row.id,
    });
    return { id: row.id, revision: row.revision + 1 };
  });
}
