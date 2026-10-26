import { BusinessError } from '@caiwu/core';

/** 用整数求和，避免正负大额相抵时中间结果丢失一分。对外仍只返回安全整数分。 */
export function sumMoney(values: Iterable<number | null | undefined>): number {
  let result = 0n;
  for (const value of values) {
    if (value == null) continue;
    if (!Number.isSafeInteger(value))
      throw new BusinessError({
        code: 'PERIOD_CLOSE_UNSAFE_MONEY',
        message: '金额或数量不是安全整数',
        hint: '核对期初和凭证，处理超出范围的数据后再重试',
      });
    result += BigInt(value);
  }
  const number = Number(result);
  if (!Number.isSafeInteger(number))
    throw new BusinessError({
      code: 'PERIOD_CLOSE_UNSAFE_MONEY',
      message: '金额或数量合计超出安全整数范围',
      hint: '调整汇总范围或拆分科目后再办理期末业务',
    });
  return number;
}
