import type { CoreServices } from '@caiwu/core/server';
import {
  isPeriod,
  isValidDate,
  nextPeriod,
  periodEndDate,
  periodOfDate,
  type InventorySnapshot,
} from '@caiwu/core';
import { fail, integer } from './math';

// 库存 DTO 和读取入口只有 core 这一份；成本模块不投影、不查询库存私有表。
export const readInventory = (svc: CoreServices, period: number): Promise<InventorySnapshot> =>
  svc.inventory.snapshot(period);

/** 从控制锚点反向走到启用月，验证所有有效批次恰好构成一条连续链。
 * 相邻月份各有一个批次并不能证明它们有承接关系。报表遇到断链保持未知。 */
export function verifiedHistory(snapshot: InventorySnapshot) {
  if (snapshot.version !== 1) return null;
  const active = snapshot.batches.filter((b) => b.status === 'calculated');
  const byId = new Map(active.map((b) => [b.id, b]));
  const { costBatch, costPeriod, costCutoffDate } = snapshot.control;
  if (byId.size !== active.length) return null;
  if (costBatch === null)
    return active.length === 0 && costPeriod === null && costCutoffDate === null ? byId : null;
  let current = byId.get(costBatch);
  if (
    !current ||
    !isPeriod(current.period) ||
    current.period !== costPeriod ||
    costCutoffDate !== periodEndDate(current.period)
  )
    return null;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id) || !isPeriod(current.period)) return null;
    visited.add(current.id);
    if (current.previous_batch_id === null) {
      if (current.period !== snapshot.startPeriod) return null;
      break;
    }
    const previous = byId.get(current.previous_batch_id);
    if (!previous || !isPeriod(previous.period) || nextPeriod(previous.period) !== current.period)
      return null;
    current = previous;
  }
  return visited.size === active.length ? byId : null;
}

export function assertHistory(snapshot: InventorySnapshot) {
  const history = verifiedHistory(snapshot);
  if (!history)
    fail(
      'HISTORY_UNVERIFIED',
      '正式成本批次链与库存控制锚点不一致',
      '请核对启用月至当前的有效批次及承接关系，不能跳月或补零核算',
    );
  return history;
}

type Document = InventorySnapshot['documents'][number];
type Movement = InventorySnapshot['movements'][number];
export function isUnverifiedHistory(snapshot: InventorySnapshot, doc: Document): boolean {
  return (
    doc.calculationStatus === 'calculated' ||
    (isPeriod(snapshot.control.costPeriod) && doc.period < snapshot.control.costPeriod)
  );
}

export function officialCost(
  snapshot: InventorySnapshot,
  doc: Document,
  line: Movement,
): number | null {
  const history = verifiedHistory(snapshot);
  const batch = doc.calculationBatch && history?.get(doc.calculationBatch);
  if (
    !batch ||
    batch.period !== doc.period ||
    doc.kind !== 'issue' ||
    line.documentId !== doc.id ||
    !isValidDate(doc.date) ||
    periodOfDate(doc.date) !== doc.period ||
    doc.calculationStatus !== 'calculated' ||
    line.calculationStatus !== 'calculated' ||
    doc.calculationBatch !== line.calculationBatch ||
    doc.calculationPeriod !== doc.period ||
    line.calculationPeriod !== doc.period ||
    doc.calculationCutoffDate !== periodEndDate(doc.period) ||
    line.outboundCostCents == null
  )
    return null;
  if (integer(line.outboundCostCents) < 0n) fail('SOURCE_COST', '库存已核算成本不合法');
  return line.outboundCostCents;
}
