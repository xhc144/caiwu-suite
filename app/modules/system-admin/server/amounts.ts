import { BusinessError } from '@caiwu/core';

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export function exactCents(value: number): bigint {
  if (!Number.isSafeInteger(value))
    throw new BusinessError({
      code: 'AMOUNT_INVALID',
      message: '金额不是安全整数分',
      hint: '请核对相关科目、期初或凭证的原始金额',
    });
  return BigInt(value);
}

export function checkedCents(total: bigint): number {
  if (total < -MAX_CENTS || total > MAX_CENTS)
    throw new BusinessError({
      code: 'AMOUNT_OVERFLOW',
      message: '金额合计超出安全整数范围',
      hint: '请分范围核查或导出',
    });
  return Number(total);
}

/** 中间值保持 bigint，允许大额正负抵销，只在最终转回接口整数分时检查范围。 */
export function sumCents(values: Iterable<number>): number {
  let total = 0n;
  for (const value of values) total += exactCents(value);
  return checkedCents(total);
}
