import { BusinessError, Decimal, multiplyToCents, toCents } from '@caiwu/core';
import { OpeningRowSchema, type OpeningRowInput } from './shared';

export function openingCents(yuan: string): number {
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(yuan.trim()))
    throw new BusinessError({
      code: 'INVENTORY_OPENING_AMOUNT',
      message: '金额必须为非负十进制元，最多两位小数，不能自动舍入',
      hint: '请核对金额；负数期初的原版规则尚缺证据',
    });
  try {
    return toCents(yuan.trim());
  } catch {
    throw new BusinessError({
      code: 'INVENTORY_OPENING_AMOUNT',
      message: '期初金额超出整数分安全范围',
      hint: '请降低金额后重试；本次未保存',
    });
  }
}

/** A conservative supported subset, not a reconstruction of PB itemchanged.
 * Never change the entered cents to fit a six-decimal reverse price. */
export function openingValue(raw: OpeningRowInput) {
  const row = OpeningRowSchema.parse(raw);
  if (row.valueBasis === 'unitPrice') {
    try {
      return {
        valueBasis: row.valueBasis,
        unitPrice: row.unitPrice!,
        amountCents: multiplyToCents(row.quantity, row.unitPrice!),
      };
    } catch {
      throw new BusinessError({
        code: 'INVENTORY_OPENING_AMOUNT',
        message: '数量乘单价得到的期初金额超出整数分安全范围',
        hint: '请核对数量和单价后重试；本次未保存',
      });
    }
  }
  if (new Decimal(row.quantity).isZero())
    throw new BusinessError({
      code: 'INVENTORY_OPENING_ZERO_QUANTITY',
      message: '数量为零，无法反算期初单价；本次未保存',
      hint: '请核对数量。零数量零金额可选择数量×单价；零数量非零金额的原版规则尚缺证据',
    });
  const amountCents = row.amountCents!;
  const unitPrice = new Decimal(amountCents)
    .div(100)
    .div(row.quantity)
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    .toFixed();
  if (
    !new Decimal(row.quantity)
      .mul(unitPrice)
      .mul(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .eq(amountCents)
  )
    throw new BusinessError({
      code: 'INVENTORY_OPENING_ROUNDING',
      message: '六位小数反算单价无法回算到输入金额；本次未保存',
      hint: '请核对数量和金额。原版尾差处理规则尚缺证据，系统不会调整金额或数量',
    });
  return { valueBasis: row.valueBasis, unitPrice, amountCents };
}
