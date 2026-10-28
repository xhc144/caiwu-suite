import type { CoreServices } from '@caiwu/core/server';
import type { DocumentInput } from '../shared';
import type { InventoryTables } from './migrations';
import { e6, fail, quantity } from './service';

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
    if (l.id === excludeDocumentId || l.reversal_document_id != null) continue;
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
    if (amount > BigInt(e6(row.remaining)))
      fail(
        'CONTRACT_EXCEEDED',
        `产品 ${code} 的本次入库超过合同未入库数量 ${row.remaining}`,
        '请减少本次数量；需退回原采购时先反冲对应入库单',
      );
  }
  return fulfillment;
}
