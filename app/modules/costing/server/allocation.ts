import { Decimal } from '@caiwu/core';
import { fail, integer, roundedRatio, safe } from './math';

/** 各类别分别累计分配，差额留给后行，分配前后总额严格相等。 */
export function allocateCents(total: number, weights: string[]): number[] {
  integer(total);
  const decimals = weights.map((value) => new Decimal(value));
  if (decimals.some((w) => !w.isFinite() || w.isNegative())) fail('BASIS', '分摊基数不能为负');
  const places = Math.max(0, ...decimals.map((w) => w.decimalPlaces()));
  // 不做 Decimal 乘法：数量与系数乘积可能超过其默认有效位数。
  const values = decimals.map((w) => BigInt(w.toFixed(places).replace('.', '')));
  const basis = values.reduce((a, b) => a + b, 0n);
  if (basis === 0n) {
    if (total !== 0)
      fail('BASIS', '没有有效分摊基数，不能分配费用', '请录入完工数量或核对销售记录');
    return values.map(() => 0);
  }
  let usedWeight = 0n;
  let usedAmount = 0n;
  return values.map((weight) => {
    usedWeight += weight;
    const cumulative = roundedRatio(integer(total) * usedWeight, basis);
    const amount = safe(cumulative - usedAmount);
    usedAmount = cumulative;
    return amount;
  });
}
