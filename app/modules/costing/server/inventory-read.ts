import { createHash } from 'node:crypto';
import type { CoreServices } from '@caiwu/core/server';
import {
  Decimal,
  isPeriod,
  isValidDate,
  nextPeriod,
  periodEndDate,
  periodStartDate,
  periodOfDate,
  type InventorySnapshot as SharedInventorySnapshot,
} from '@caiwu/core';
import { sql } from '@caiwu/db';
import { fail, integer } from './math';

/** 库存只读投影；正式承接和批次链由共享库存快照提供。禁止在此写库存。 */
export type InventoryReadTables = {
  inventory_control: {
    id: number;
    stock_revision: number;
    opening_revision: number;
    cost_period: number | null;
    cost_cutoff_date: string | null;
    cost_batch: string | null;
    opening_locked: number;
  };
  inventory_product: {
    id: number;
    code: string;
    name: string;
    inventory_account_id: number | null;
    sales_account_id: number | null;
    revision: number;
  };
  inventory_warehouse: { id: number; code: string; name: string; revision: number };
  inventory_opening: {
    id: number;
    warehouse_id: number;
    product_id: number;
    quantity_e6: number;
    amount_cents: number;
  };
  inventory_document: {
    id: number;
    kind: 'receipt' | 'issue';
    warehouse_id: number;
    number: string;
    date: string;
    period: number;
    category: string;
    account_id: number | null;
    cost_account_id: number | null;
    voucher_id: number | null;
    revision: number;
    calculation_status: string;
    calculation_batch: string | null;
    calculation_period: number | null;
    calculation_cutoff_date: string | null;
  };
  inventory_line: {
    id: number;
    document_id: number;
    product_id: number;
    position: number;
    quantity_e6: number;
    net_cents: number;
    tax_cents: number;
    gross_cents: number;
    outbound_cost_cents: number | null;
    calculation_status: string;
    calculation_batch: string | null;
    calculation_period: number | null;
  };
  inventory_count: { id: number; warehouse_id: number; period: number; revision: number };
  inventory_count_line: {
    id: number;
    count_id: number;
    product_id: number;
    book_e6: number;
    actual_e6: number;
  };
};
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function inventoryReader(svc: CoreServices) {
  const available = await sql<{
    name: string;
  }>`SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_control'`.execute(
    svc.db,
  );
  if (!available.rows.length)
    fail(
      'INVENTORY_REQUIRED',
      '当前账套尚未启用仓库进销存',
      '先启用仓库模块并录入产品、期初和单据',
    );
  return svc.db.withTables<InventoryReadTables>();
}

export async function readInventory(svc: CoreServices, through: number) {
  const db = await inventoryReader(svc);
  const book = await svc.book.info();
  if (through < book.startPeriod) fail('BEFORE_OPENING', '核算年月不能早于账套启用年月');
  await svc.periods.require(through);
  const control = await db
    .selectFrom('inventory_control')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  const products = await db.selectFrom('inventory_product').selectAll().orderBy('id').execute();
  const warehouses = await db.selectFrom('inventory_warehouse').selectAll().orderBy('id').execute();
  const opening = await db.selectFrom('inventory_opening').selectAll().orderBy('id').execute();
  const documents = await db
    .selectFrom('inventory_document')
    .selectAll()
    .where('date', '<=', periodEndDate(through))
    .orderBy('date')
    .orderBy('id')
    .execute();
  for (const d of documents) {
    if (d.date < periodStartDate(book.startPeriod) || periodOfDate(d.date) !== d.period)
      fail('SOURCE_DATE', `单据 ${d.number} 的日期与期间不一致或早于启用日期`);
  }
  const lines = await db
    .selectFrom('inventory_line as l')
    .innerJoin('inventory_document as d', 'd.id', 'l.document_id')
    .selectAll('l')
    .where('d.date', '<=', periodEndDate(through))
    .orderBy('l.document_id')
    .orderBy('l.position')
    .orderBy('l.id')
    .execute();
  const counts = await db
    .selectFrom('inventory_count')
    .selectAll()
    .where('period', '>=', book.startPeriod)
    .where('period', '<=', through)
    .orderBy('id')
    .execute();
  const countLines = await db
    .selectFrom('inventory_count_line as l')
    .innerJoin('inventory_count as c', 'c.id', 'l.count_id')
    .selectAll('l')
    .where('c.period', '>=', book.startPeriod)
    .where('c.period', '<=', through)
    .orderBy('l.id')
    .execute();
  for (const l of lines) {
    integer(l.quantity_e6);
    integer(l.net_cents);
    integer(l.tax_cents);
    integer(l.gross_cents);
    if (BigInt(l.net_cents) + BigInt(l.tax_cents) !== BigInt(l.gross_cents))
      fail('SOURCE_AMOUNT', `单据明细 ${l.id} 的价税合计不一致`);
  }
  const data = {
    startPeriod: book.startPeriod,
    control,
    products,
    warehouses,
    opening,
    documents,
    lines,
    counts,
    countLines,
  };
  const sharedSnapshot = await svc.inventory.snapshot(through);
  return { ...data, sharedSnapshot, fingerprint: sharedSnapshot.fingerprint };
}
export type InventorySnapshot = Awaited<ReturnType<typeof readInventory>>;

/** 只认从启用月连续承接到控制行锚点的真实正式批次。 */
export function verifiedBatches(snapshot: SharedInventorySnapshot): Map<string, number> {
  const active = snapshot.batches.filter((b) => b.status === 'calculated');
  const byId = new Map(active.map((b) => [b.id, b]));
  const verified = new Map<string, number>();
  let batch = snapshot.control.costBatch ? byId.get(snapshot.control.costBatch) : undefined;
  if (
    !batch ||
    batch.period !== snapshot.control.costPeriod ||
    snapshot.control.costCutoffDate !== periodEndDate(batch.period)
  )
    return verified;
  while (batch) {
    if (verified.has(batch.id)) return new Map();
    verified.set(batch.id, batch.period);
    if (batch.previous_batch_id == null) {
      if (batch.period !== snapshot.startPeriod) return new Map();
      break;
    }
    const previous = byId.get(batch.previous_batch_id);
    if (!previous || nextPeriod(previous.period) !== batch.period) return new Map();
    batch = previous;
  }
  return verified.size === active.length ? verified : new Map();
}

export function quantityE6(value: string): number {
  const scaled = new Decimal(value).mul(1_000_000);
  if (!scaled.isInteger()) fail('QUANTITY', '库存数量超过六位小数');
  const result = scaled.toNumber();
  integer(result);
  return result;
}

export function isUnverifiedHistory(
  snapshot: InventorySnapshot,
  doc: InventoryReadTables['inventory_document'],
): boolean {
  return (
    isPeriod(snapshot.control.cost_period) &&
    isPeriod(doc.period) &&
    doc.period < snapshot.control.cost_period
  );
}

/** 由正式批次链验证历史成本；头、行、期间和月末截止必须同时匹配。 */
export function officialCost(
  snapshot: InventorySnapshot,
  doc: InventoryReadTables['inventory_document'],
  line: InventoryReadTables['inventory_line'],
): number | null {
  if (
    !isPeriod(doc.period) ||
    !doc.calculation_batch ||
    verifiedBatches(snapshot.sharedSnapshot).get(doc.calculation_batch) !== doc.period
  )
    return null;
  const cutoff = periodEndDate(doc.period);
  if (
    doc.kind !== 'issue' ||
    line.document_id !== doc.id ||
    !isValidDate(doc.date) ||
    periodOfDate(doc.date) !== doc.period ||
    doc.calculation_status !== 'calculated' ||
    line.calculation_status !== 'calculated' ||
    !doc.calculation_batch ||
    doc.calculation_batch !== line.calculation_batch ||
    doc.calculation_period !== doc.period ||
    line.calculation_period !== doc.period ||
    doc.calculation_cutoff_date !== cutoff ||
    line.outbound_cost_cents == null
  )
    return null;
  if (integer(line.outbound_cost_cents) < 0n) fail('SOURCE_COST', '库存已核算成本不合法');
  return line.outbound_cost_cents;
}
