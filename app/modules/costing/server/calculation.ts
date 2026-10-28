import { periodRange } from '@caiwu/core';
import type { CalculationResult, CostRow } from '../shared';
import { quantityE6, type InventorySnapshot } from './inventory-read';
import { calculatePool, fail, integer, quantity, safe } from './math';

export function calculate(
  snapshot: InventorySnapshot,
  period: number,
  adjustZeroQuantity: boolean,
): CalculationResult {
  const rows: CostRow[] = [];
  const lines: CalculationResult['lines'] = [];
  const documentMap = new Map(snapshot.documents.map((d) => [d.id, d]));
  const formalOpening = snapshot.sharedSnapshot.periodOpeningReady && period > snapshot.startPeriod;
  const openingRows = formalOpening
    ? snapshot.sharedSnapshot.periodOpening.map((o) => ({
        warehouse_id: o.warehouseId,
        product_id: o.productId,
        quantity_e6: quantityE6(o.quantity),
        amount_cents: o.amountCents,
      }))
    : snapshot.opening;
  const keys = new Map<string, { warehouseId: number; productId: number }>();
  const addKey = (warehouseId: number, productId: number) =>
    keys.set(`${warehouseId}:${productId}`, { warehouseId, productId });
  for (const o of openingRows) addKey(o.warehouse_id, o.product_id);
  for (const l of snapshot.lines)
    if (!formalOpening || documentMap.get(l.document_id)!.period === period)
      addKey(documentMap.get(l.document_id)!.warehouse_id, l.product_id);
  for (const l of snapshot.countLines) {
    const count = snapshot.counts.find((c) => c.id === l.count_id)!;
    if (!formalOpening || count.period === period) addKey(count.warehouse_id, l.product_id);
  }
  for (const { warehouseId, productId } of keys.values()) {
    const product = snapshot.products.find((p) => p.id === productId);
    if (!product || !snapshot.warehouses.some((w) => w.id === warehouseId))
      fail('SOURCE', '库存来源缺少产品或仓库档案');
    const opening = openingRows.find(
      (o) => o.warehouse_id === warehouseId && o.product_id === productId,
    );
    let openingQ = opening?.quantity_e6 ?? 0;
    let openingA = opening?.amount_cents ?? 0;
    for (const p of periodRange(formalOpening ? period : snapshot.startPeriod, period)) {
      const current = snapshot.lines
        .filter((l) => {
          const d = documentMap.get(l.document_id)!;
          return l.product_id === productId && d.warehouse_id === warehouseId && d.period === p;
        })
        .sort((a, b) => {
          const da = documentMap.get(a.document_id)!;
          const db = documentMap.get(b.document_id)!;
          return (
            da.date.localeCompare(db.date) ||
            da.id - db.id ||
            a.position - b.position ||
            a.id - b.id
          );
        });
      const count = snapshot.counts.find((c) => c.warehouse_id === warehouseId && c.period === p);
      const countLine =
        count &&
        snapshot.countLines.find((l) => l.count_id === count.id && l.product_id === productId);
      const result = calculatePool({
        openingQuantityE6: openingQ,
        openingCents: openingA,
        receipts: current
          .filter((l) => documentMap.get(l.document_id)!.kind === 'receipt')
          .map((l) => ({ quantityE6: l.quantity_e6, netCents: l.net_cents })),
        issues: current
          .filter((l) => documentMap.get(l.document_id)!.kind === 'issue')
          .map((l) => ({ id: l.id, documentId: l.document_id, quantityE6: l.quantity_e6 })),
        actualQuantityE6: countLine?.actual_e6,
        adjustZeroQuantity,
      });
      if (countLine) {
        const expectedBook =
          integer(openingQ) +
          current.reduce(
            (n, l) =>
              n +
              (documentMap.get(l.document_id)!.kind === 'receipt' ? 1n : -1n) *
                integer(l.quantity_e6),
            0n,
          );
        if (integer(countLine.book_e6) !== expectedBook)
          fail(
            'STALE_COUNT',
            `产品 ${product.code} 的 ${p} 盘点账面数量已变化`,
            '先重新生成盘点表并核对实盘数，再试算',
          );
      }
      if (p === period) {
        const { lines: calculatedLines, closingQuantityE6: _e6, ...values } = result;
        rows.push({
          warehouseId,
          warehouseName: snapshot.warehouses.find((w) => w.id === warehouseId)!.name,
          productId,
          productCode: product.code,
          productName: product.name,
          openingQuantity: quantity(integer(openingQ)),
          openingCents: openingA,
          ...values,
        });
        lines.push(...calculatedLines);
      }
      openingQ = result.closingQuantityE6;
      openingA = result.closingCents;
    }
  }
  safe(rows.reduce((n, r) => n + integer(r.issuedCents), 0n));
  return {
    period,
    method: 'monthly-weighted-average',
    status: 'preview',
    fingerprint: snapshot.fingerprint,
    rows: rows.sort(
      (a, b) => a.warehouseId - b.warehouseId || a.productCode.localeCompare(b.productCode),
    ),
    lines,
  };
}
