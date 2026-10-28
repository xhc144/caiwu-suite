import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { Decimal } from '@caiwu/core';
import { isInDatabaseTransaction } from '@caiwu/db';
import type { CoreServices } from '@caiwu/core/server';
import { DocumentSchema, type DocumentInput } from '../shared';
import { priceLine } from '../math';
import type { InventoryTables } from './migrations';
import { e6, fail, quantity } from './service';

type HistoryPair = { receipt: DocumentInput; reversal: DocumentInput };
const fingerprint = (input: DocumentInput) => {
  const { negativeConfirmation: _n, ...document } = DocumentSchema.parse(input);
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
};
const histories = new AsyncLocalStorage<{
  db: CoreServices['db'];
  actorId: number;
  active: boolean;
  commit: boolean;
  pairs: (HistoryPair & { hash: string; reversed: Map<string, bigint> })[];
}>();
function historyFor(svc: CoreServices) {
  const history = histories.getStore();
  return history?.active &&
    history.db === svc.db &&
    history.actorId === svc.user.id &&
    svc.moduleId === 'inventory'
    ? history
    : undefined;
}

export function assertContractHistoryWrite(svc: CoreServices) {
  const history = historyFor(svc);
  if (history && !history.commit)
    fail('HISTORY_PREVIEW_WRITE', '合同反冲历史尚处于预览，不能保存单据');
}

/** 仅整批导入事务可计入已验证反冲的净数量；退出前核对真实头行、请求及关联。 */
export async function withContractReversalHistory<T>(
  svc: CoreServices,
  pairs: HistoryPair[],
  commit: boolean,
  run: () => Promise<T>,
): Promise<T> {
  if (!pairs.length) return run();
  if (svc.moduleId !== 'inventory' || !svc.db.isTransaction || !isInDatabaseTransaction())
    fail('HISTORY_SCOPE', '合同反冲历史只能通过多单文件转入办理');
  svc.permissions.require('inventory.import');
  svc.permissions.require('inventory.edit');
  const signature = (d: DocumentInput) =>
    JSON.stringify(
      d.lines.map((l) => [
        l.productCode,
        e6(l.quantity),
        new Decimal(l.unitPrice).toFixed(),
        !!l.priceIncludesTax,
      ]),
    );
  const plans = pairs.map((pair) => {
    const receipt = DocumentSchema.parse(pair.receipt),
      reversal = DocumentSchema.parse(pair.reversal);
    if (
      receipt.id != null ||
      reversal.id != null ||
      receipt.sourceType !== 'contract' ||
      receipt.sourceId == null ||
      reversal.sourceType != null ||
      reversal.sourceId != null ||
      receipt.kind !== 'receipt' ||
      reversal.kind !== 'issue' ||
      reversal.category !== '其他出库' ||
      receipt.warehouseId !== reversal.warehouseId ||
      reversal.date < receipt.date ||
      receipt.invoiceKind !== reversal.invoiceKind ||
      new Decimal(receipt.taxRate).cmp(reversal.taxRate) !== 0 ||
      signature(receipt) !== signature(reversal)
    )
      fail('HISTORY_PAIR', '合同反冲历史必须是完整且数量、计价、方向和仓库一致的原入库与反冲对');
    const reversed = new Map<string, bigint>();
    for (const l of reversal.lines)
      reversed.set(l.productCode, (reversed.get(l.productCode) ?? 0n) + BigInt(e6(l.quantity)));
    return { receipt, reversal, hash: fingerprint(receipt), reversed };
  });
  const db = svc.db.withTables<InventoryTables>();
  const keys = plans.flatMap((p) => [p.receipt.requestKey, p.reversal.requestKey]);
  if (
    new Set(keys).size !== keys.length ||
    (await db
      .selectFrom('inventory_request')
      .select('request_key')
      .where('request_key', 'in', keys)
      .executeTakeFirst())
  )
    fail('HISTORY_REQUEST', '合同反冲历史的保存编号已被使用，请重新预览');
  const history = { db: svc.db, actorId: svc.user.id, active: true, commit, pairs: plans };
  return histories.run(history, async () => {
    try {
      const result = await run();
      history.active = false;
      if (commit) {
        const requests = await db
          .selectFrom('inventory_request')
          .selectAll()
          .where('request_key', 'in', keys)
          .execute();
        const verify = async (id: number, input: DocumentInput) => {
          const v = DocumentSchema.parse(input);
          const d = await db
            .selectFrom('inventory_document')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
          const rows = await db
            .selectFrom('inventory_line as l')
            .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
            .selectAll('l')
            .select('p.code')
            .where('l.document_id', '=', id)
            .orderBy('l.position')
            .execute();
          const expected = v.lines.map((l) => {
            const p = priceLine(l.quantity, l.unitPrice, v.taxRate, l.priceIncludesTax ?? false);
            return [
              l.productCode,
              e6(l.quantity),
              l.priceIncludesTax ? 1 : 0,
              p.net_cents,
              p.tax_cents,
              p.gross_cents,
              new Decimal(p.unit_price).toFixed(),
              new Decimal(p.tax_unit_price).toFixed(),
              l.note,
            ];
          });
          if (
            !d ||
            d.kind !== v.kind ||
            d.warehouse_id !== v.warehouseId ||
            d.number !== v.number ||
            d.date !== v.date ||
            d.category !== v.category ||
            d.operator !== (v.operator || svc.user.name) ||
            d.summary !== v.summary ||
            d.account_id !== v.accountId ||
            d.cost_account_id !== v.costAccountId ||
            d.tax_rate !== v.taxRate ||
            d.invoice_kind !== v.invoiceKind ||
            d.source_type !== v.sourceType ||
            d.source_id !== v.sourceId ||
            d.created_by !== svc.user.id ||
            JSON.stringify(
              rows.map((l) => [
                l.code,
                l.quantity_e6,
                l.price_includes_tax,
                l.net_cents,
                l.tax_cents,
                l.gross_cents,
                new Decimal(l.unit_price).toFixed(),
                new Decimal(l.tax_unit_price).toFixed(),
                l.note,
              ]),
            ) !== JSON.stringify(expected)
          )
            fail('HISTORY_CHANGED', '合同反冲历史的实际保存头行与已校验文件不一致，整批未保存');
        };
        for (const plan of plans) {
          const original = requests.find((r) => r.request_key === plan.receipt.requestKey);
          const reversed = requests.find((r) => r.request_key === plan.reversal.requestKey);
          const reversal = {
            ...plan.reversal,
            sourceType: 'document' as const,
            sourceId: original?.document_id,
          };
          if (
            !original ||
            !reversed ||
            original.payload_hash !== plan.hash ||
            reversed.payload_hash !== fingerprint(reversal)
          )
            fail('HISTORY_INCOMPLETE', '合同反冲历史未完整保存，整批未保存');
          const relation = await db
            .selectFrom('inventory_reversal')
            .selectAll()
            .where('original_document_id', '=', original.document_id)
            .executeTakeFirst();
          if (relation?.reversal_document_id !== reversed.document_id)
            fail('HISTORY_INCOMPLETE', '合同反冲历史缺少真实反冲关联，整批未保存');
          await verify(original.document_id, plan.receipt);
          await verify(reversed.document_id, reversal);
        }
        for (const id of new Set(plans.map((p) => p.receipt.sourceId!)))
          await assertContractWithinPlan(svc, id, '多单转入');
      }
      return result;
    } finally {
      history.active = false;
    }
  });
}

/** 合同与库存仍各自保存；只按有效来源入库累计履约，整单反冲及删除会恢复余额。 */
export async function contractFulfillment(
  svc: CoreServices,
  id: number,
  excludeDocumentId?: number,
) {
  const db = svc.db.withTables<InventoryTables>();
  const contract = await db
    .selectFrom('inventory_contract')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!contract) fail('CONTRACT', '采购合同已不存在', '请刷新合同列表');
  const planned = await db
    .selectFrom('inventory_contract_line as l')
    .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
    .selectAll('l')
    .select(['p.code', 'p.name'])
    .where('l.contract_id', '=', id)
    .orderBy('l.id')
    .execute();
  const received = await db
    .selectFrom('inventory_document as d')
    .innerJoin('inventory_line as l', 'l.document_id', 'd.id')
    .leftJoin('inventory_reversal as r', 'r.original_document_id', 'd.id')
    .select([
      'd.id',
      'd.number',
      'd.date',
      'd.revision',
      'l.product_id',
      'l.quantity_e6',
      'r.reversal_document_id',
    ])
    .where('d.source_type', '=', 'contract')
    .where('d.source_id', '=', id)
    .execute();
  const history = historyFor(svc);
  const pending = history?.pairs.filter((p) => p.receipt.sourceId === id) ?? [];
  const historicalIds = new Set<number>();
  if (pending.length) {
    const requests = await db
      .selectFrom('inventory_request')
      .selectAll()
      .where(
        'request_key',
        'in',
        pending.map((p) => p.receipt.requestKey),
      )
      .execute();
    for (const r of requests)
      if (pending.some((p) => p.receipt.requestKey === r.request_key && p.hash === r.payload_hash))
        historicalIds.add(r.document_id);
  }
  const totals = new Map<
    number,
    { productCode: string; productName: string; planned: bigint; received: bigint }
  >();
  for (const l of planned) {
    const row = totals.get(l.product_id) ?? {
      productCode: l.code,
      productName: l.name,
      planned: 0n,
      received: 0n,
    };
    row.planned += BigInt(l.quantity_e6);
    totals.set(l.product_id, row);
  }
  for (const l of received) {
    if (l.id === excludeDocumentId || l.reversal_document_id != null || historicalIds.has(l.id))
      continue;
    const row = totals.get(l.product_id);
    if (!row)
      fail(
        'CONTRACT_PRODUCT',
        '合同已有入库产品不在当前合同中',
        '请核对来源入库单与合同，不要继续新增入库',
      );
    row.received += BigInt(l.quantity_e6);
  }
  const asQuantity = (n: bigint) => {
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER))
      fail('CONTRACT_QUANTITY', '合同累计数量超出允许范围', '请拆分合同并核对数量');
    return quantity(Number(n));
  };
  return {
    contract,
    rows: [...totals.values()].map((r) => ({
      productCode: r.productCode,
      productName: r.productName,
      planned: asQuantity(r.planned),
      received: asQuantity(r.received),
      remaining: asQuantity(r.planned - r.received),
    })),
    documents: [
      ...new Map(
        received.map((r) => [
          r.id,
          {
            id: r.id,
            number: r.number,
            date: r.date,
            revision: r.revision,
            reversed: r.reversal_document_id != null,
          },
        ]),
      ).values(),
    ],
  };
}

export async function assertContractReceipt(svc: CoreServices, input: DocumentInput) {
  const fulfillment = await contractFulfillment(svc, input.sourceId!, input.id);
  const { contract: c } = fulfillment;
  if (input.kind !== 'receipt' || c.status !== 'open' || c.warehouse_id !== input.warehouseId)
    fail('SOURCE', '来源采购合同已结束或入库方向、仓库不符');
  if (input.date < c.date) fail('CONTRACT_DATE', '入库日期不能早于来源采购合同日期');
  const requested = new Map<string, bigint>();
  const binding = historyFor(svc);
  const inputHash = binding ? fingerprint(input) : undefined;
  const history = binding?.pairs.find((p) => p.hash === inputHash);
  for (const l of input.lines)
    requested.set(l.productCode, (requested.get(l.productCode) ?? 0n) + BigInt(e6(l.quantity)));
  for (const [code, amount] of requested) {
    const row = fulfillment.rows.find((r) => r.productCode === code);
    if (!row)
      fail(
        'CONTRACT_PRODUCT',
        `产品 ${code} 不在来源采购合同中`,
        '请改用合同内产品，或取消合同来源后另办采购',
      );
    const effective = amount - (history?.reversed.get(code) ?? 0n);
    if (effective > BigInt(e6(row.remaining)))
      fail(
        'CONTRACT_EXCEEDED',
        `产品 ${code} 的本次入库超过合同未入库数量 ${row.remaining}`,
        '请减少本次数量；需退回原采购时先反冲对应入库单',
      );
  }
  return fulfillment;
}

/** 关联恢复或撤销后检查真实履约，失败由调用方的同一事务整体回滚。 */
export async function assertContractWithinPlan(
  svc: CoreServices,
  id: number,
  action: '多单转入' | '撤销反冲',
) {
  const fulfillment = await contractFulfillment(svc, id);
  const exceeded = fulfillment.rows.find((row) => e6(row.remaining) < 0);
  if (exceeded)
    fail(
      'CONTRACT_EXCEEDED',
      `${action}会使产品 ${exceeded.productCode} 的合同累计入库超过计划数量 ${exceeded.planned}`,
      '合同额度可能已被后续入库使用；请先处理后续合同入库，恢复足够额度后重试',
    );
}
