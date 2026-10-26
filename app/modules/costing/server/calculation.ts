import { nextPeriod, periodOfDate, periodStartDate, type InventorySnapshot } from '@caiwu/core';
import type { CalculationResult, CostRow } from '../shared';
import { assertHistory } from './inventory-read';
import { calculatePool, e6, fail, integer, safe } from './math';

/** 只计算一个月，期初直接采用共享快照 periodOpening，不重演历史试算。 */
export function calculate(
  snapshot: InventorySnapshot,
  period: number,
  adjustZeroQuantity: boolean,
): CalculationResult {
  const history = assertHistory(snapshot);
  if (snapshot.version !== 1 || snapshot.period !== period)
    fail('SNAPSHOT', '库存快照版本或年月与本次核算不一致');
  if (!snapshot.periodOpeningReady)
    fail('OPENING_UNREADY', '本月正式期初尚未就绪', '请先从启用月份开始逐月完成正式核算');
  if (snapshot.periodOpening.some((o) => o.sourceBatchId !== snapshot.previousBatchId))
    fail('OPENING_SOURCE', '本月期初来源与上一有效批次不一致', '请核对库存正式结存');
  const previous = snapshot.previousBatchId && history.get(snapshot.previousBatchId);
  let validOpening = snapshot.previousBatchId === null;
  if (period !== snapshot.startPeriod) {
    validOpening = !!previous && nextPeriod(previous.period) === period;
  }
  if (!validOpening)
    fail('OPENING_SOURCE', '本月期初没有连续有效的前月正式批次', '请先核对正式批次链');
  const openingKeys = new Set(snapshot.periodOpening.map((o) => `${o.warehouseId}:${o.productId}`));
  const requiredKeys = new Set(snapshot.opening.map((o) => `${o.warehouseId}:${o.productId}`));
  const oldDocuments = new Map(
    snapshot.documents.filter((d) => d.period < period).map((d) => [d.id, d]),
  );
  for (const l of snapshot.movements) {
    const d = oldDocuments.get(l.documentId);
    if (d) requiredKeys.add(`${d.warehouseId}:${l.productId}`);
  }
  for (const c of snapshot.counts.filter((c) => c.period < period)) {
    for (const l of c.lines) {
      requiredKeys.add(`${c.warehouseId}:${l.productId}`);
    }
  }
  if (
    openingKeys.size !== snapshot.periodOpening.length ||
    [...requiredKeys].some((key) => !openingKeys.has(key))
  )
    fail(
      'OPENING_INCOMPLETE',
      '正式期初缺少历史库存项目或存在重复项目',
      '请核对前月正式结存，不能补零继续核算',
    );
  const rows: CostRow[] = [];
  const lines: CalculationResult['lines'] = [];
  const documents = snapshot.documents.filter((d) => d.period === period);
  const documentMap = new Map(documents.map((d) => [d.id, d]));
  const movements = snapshot.movements.filter((l) => documentMap.has(l.documentId));
  const counts = snapshot.counts.filter((c) => c.period === period);
  for (const d of snapshot.documents)
    if (periodOfDate(d.date) !== d.period || d.date < periodStartDate(snapshot.startPeriod))
      fail('SOURCE_DATE', `单据 ${d.number} 日期与期间不一致或早于启用日期`);
  for (const l of snapshot.movements) {
    if (e6(l.quantity) <= 0 || integer(l.netCents) < 0n || integer(l.taxCents) < 0n)
      fail('SOURCE_AMOUNT', `单据明细 ${l.id} 的数量或金额不合法`);
    if (integer(l.netCents) + integer(l.taxCents) !== integer(l.grossCents))
      fail('SOURCE_AMOUNT', `单据明细 ${l.id} 的价税合计不一致`);
  }
  const keys = new Map<string, { warehouseId: number; productId: number }>();
  const addKey = (warehouseId: number, productId: number) =>
    keys.set(`${warehouseId}:${productId}`, { warehouseId, productId });
  for (const o of snapshot.periodOpening) addKey(o.warehouseId, o.productId);
  for (const l of movements) addKey(documentMap.get(l.documentId)!.warehouseId, l.productId);
  for (const c of counts) {
    for (const l of c.lines) {
      addKey(c.warehouseId, l.productId);
    }
  }
  for (const { warehouseId, productId } of keys.values()) {
    const product = snapshot.products.find((p) => p.id === productId);
    const warehouse = snapshot.warehouses.find((w) => w.id === warehouseId);
    if (!product || !warehouse) fail('SOURCE', '库存来源缺少产品或仓库档案');
    const opening = snapshot.periodOpening.find(
      (o) => o.warehouseId === warehouseId && o.productId === productId,
    );
    // 快照已证明期初就绪；本月首次出现的产品没有期初记录，才从零开始。
    const openingQ = opening ? e6(opening.quantity) : 0;
    const openingA = opening?.amountCents ?? 0;
    const current = movements
      .filter((l) => {
        const document = documentMap.get(l.documentId)!;
        return l.productId === productId && document.warehouseId === warehouseId;
      })
      .sort((a, b) => {
        const da = documentMap.get(a.documentId)!;
        const db = documentMap.get(b.documentId)!;
        const dateOrder = da.date.localeCompare(db.date);
        const documentOrder = da.id - db.id;
        const positionOrder = a.position - b.position;
        return dateOrder || documentOrder || positionOrder || a.id - b.id;
      });
    const count = counts.find((c) => c.warehouseId === warehouseId);
    const countLine = count?.lines.find((l) => l.productId === productId);
    const result = calculatePool({
      openingQuantityE6: openingQ,
      openingCents: openingA,
      receipts: current
        .filter((l) => documentMap.get(l.documentId)!.kind === 'receipt')
        .map((l) => ({ quantityE6: e6(l.quantity), netCents: l.netCents })),
      issues: current
        .filter((l) => documentMap.get(l.documentId)!.kind === 'issue')
        .map((l) => ({ id: l.id, documentId: l.documentId, quantityE6: e6(l.quantity) })),
      actualQuantityE6: countLine ? e6(countLine.actualQuantity) : undefined,
      adjustZeroQuantity,
    });
    if (countLine) {
      const expectedBook =
        integer(openingQ) +
        current.reduce(
          (n, l) => {
            const sign = documentMap.get(l.documentId)!.kind === 'receipt' ? 1n : -1n;
            return n + sign * integer(e6(l.quantity));
          },
          0n,
        );
      if (integer(e6(countLine.bookQuantity)) !== expectedBook)
        fail(
          'STALE_COUNT',
          `产品 ${product.code} 的 ${period} 盘点账面数量已变化`,
          '先重新生成盘点表并核对实盘数，再试算',
        );
    }
    const { lines: calculatedLines, closingQuantityE6: _e6, ...values } = result;
    rows.push({
      warehouseId,
      warehouseName: warehouse.name,
      productId,
      productCode: product.code,
      productName: product.name,
      openingQuantity: opening?.quantity ?? '0',
      openingCents: openingA,
      ...values,
    });
    lines.push(...calculatedLines);
  }
  safe(rows.reduce((n, r) => n + integer(r.issuedCents), 0n));
  return {
    period,
    method: 'monthly-weighted-average',
    status: 'preview',
    adjustZeroQuantity,
    fingerprint: snapshot.fingerprint,
    rows: rows.sort(
      (a, b) => a.warehouseId - b.warehouseId || a.productCode.localeCompare(b.productCode),
    ),
    lines,
  };
}
