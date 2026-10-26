import { BusinessError } from '@caiwu/core';
import type { AgingLot } from '../shared';

/** 每一步检查分的安全整数；不允许汇总溢出后仍输出看似精确的账款。 */
export function cents(n: number): number {
  if (!Number.isSafeInteger(n))
    throw new BusinessError({
      code: 'ANALYSIS_AMOUNT_OVERFLOW',
      message: '分析金额超过安全整数范围',
      hint: '缩小科目或期间范围后重新查询',
      actions: [{ label: '科目分析', to: '/m/analysis' }],
    });
  return n === 0 ? 0 : n;
}
export function sum(values: Iterable<number>): number {
  let n = 0;
  for (const v of values) n = cents(n + cents(v));
  return n === 0 ? 0 : n;
}
export function bucketLabels(bounds: number[]): string[] {
  return [
    ...bounds.map((n, i) => `${i === 0 ? 0 : bounds[i - 1]! + 1}–${n}天`),
    `${bounds.at(-1)! + 1}天及以上`,
  ];
}
/**
 * 同一末级科目、辅助项、币种内按业务日期 FIFO。期初无历史日期，优先核销且残额未分龄。
 * 正负均为“正向敞口”口径：应收借正，应付贷正。红字按其真实有符号净额参与。
 */
export function allocateFifo(lots: AgingLot[], cutoff: string, bounds: number[]) {
  const copy = lots.map((l) => ({
    ...l,
    amount: cents(l.amount),
    remaining: Math.max(0, l.amount),
  }));
  const positive = copy
    .filter((l) => l.amount > 0)
    .sort(
      (a, b) =>
        (a.bizDate ?? '').localeCompare(b.bizDate ?? '') ||
        (a.date ?? '').localeCompare(b.date ?? '') ||
        (a.voucherId ?? 0) - (b.voucherId ?? 0) ||
        (a.lineId ?? 0) - (b.lineId ?? 0),
    );
  // 每笔负向收付款依次核销最早正向敞口，未抵完的收付款保持负额。
  const payments = copy
    .filter((l) => l.amount < 0)
    .sort(
      (a, b) =>
        (a.date ?? '').localeCompare(b.date ?? '') ||
        (a.voucherId ?? 0) - (b.voucherId ?? 0) ||
        (a.lineId ?? 0) - (b.lineId ?? 0),
    );
  let index = 0;
  for (const payment of payments) {
    let available = -payment.amount;
    while (available > 0 && index < positive.length) {
      const lot = positive[index]!;
      const used = Math.min(lot.remaining, available);
      lot.remaining = cents(lot.remaining - used);
      available = cents(available - used);
      if (lot.remaining === 0) index++;
    }
    payment.remaining = cents(-available);
  }
  const buckets = bounds.map(() => 0).concat(0);
  let unaged = 0;
  let future = 0;
  for (const lot of positive) {
    if (lot.bizDate == null) unaged = cents(unaged + lot.remaining);
    else {
      const days = Math.round(
        (Date.parse(`${cutoff}T00:00:00Z`) - Date.parse(`${lot.bizDate}T00:00:00Z`)) / 86400000,
      );
      if (days < 0) future = cents(future + lot.remaining);
      else {
        const index = bounds.findIndex((n) => days <= n);
        const i = index < 0 ? bounds.length : index;
        buckets[i] = cents(buckets[i]! + lot.remaining);
      }
    }
  }
  const reverse = sum(payments.map((p) => p.remaining));
  const closing = sum(copy.map((l) => l.amount));
  const allocated = sum([...buckets, unaged, future, reverse]);
  if (closing !== allocated) throw new Error('FIFO 不变量失败');
  return { buckets, unaged, future, reverse, closing, allocated, lots: copy };
}
