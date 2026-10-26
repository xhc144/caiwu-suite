import { BusinessError, Decimal, multiplyToCents, toCents } from '@caiwu/core';
/** The selected price basis is retained; each line is rounded half up to cents.
 * Tax is the residual of gross minus net, so the three amounts always reconcile. */
export function priceLine(q: string, price: string, rate: string, inclusive: boolean) {
  try {
    if (
      !/^\d{1,9}(\.\d{1,6})?$/.test(q) ||
      !/^\d{1,9}(\.\d{1,6})?$/.test(price) ||
      !/^\d{1,9}(\.\d{1,6})?$/.test(rate)
    )
      throw new Error('数字格式');
    const factor = new Decimal(rate).div(100).plus(1);
    if (new Decimal(rate).gt(100))
      throw new BusinessError({
        code: 'INVENTORY_TAX',
        message: '税率必须在 0 到 100 之间',
        hint: '请修改本单税率后重试',
      });
    const netPrice = inclusive ? new Decimal(price).div(factor) : new Decimal(price);
    const taxPrice = inclusive ? new Decimal(price) : new Decimal(price).mul(factor);
    const net = toCents(new Decimal(q).mul(netPrice));
    const gross = inclusive
      ? multiplyToCents(q, price)
      : net + toCents(new Decimal(net).div(100).mul(rate).div(100));
    if (!Number.isSafeInteger(gross)) throw new Error('金额范围');
    return {
      unit_price: netPrice.toFixed(),
      tax_unit_price: taxPrice.toFixed(),
      net_cents: net,
      tax_cents: gross - net,
      gross_cents: gross,
    };
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError({
      code: 'INVENTORY_AMOUNT',
      message: '数量、单价或税率不合法，或计算金额超出允许范围',
      hint: '请输入非负十进制字符串，最多六位小数，并降低超范围金额',
    });
  }
}
