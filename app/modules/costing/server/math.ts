import { BusinessError, Decimal } from '@caiwu/core';

export function fail(code: string, message: string, hint = '请检查来源单据后重新试算'): never {
  throw new BusinessError({ code: `COSTING_${code}`, message, hint });
}
export function integer(value: number, label = '金额或数量'): bigint {
  if (!Number.isSafeInteger(value)) fail('RANGE', `${label}必须为安全整数`);
  return BigInt(value);
}
export function safe(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) fail('RANGE', '计算结果超出安全整数范围');
  return result;
}
/** 有符号的四舍五入；金额乘除全过程使用整数，最后才转为接口的安全整数。 */
export function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) fail('BASIS', '没有可用数量，无法确定加权成本');
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  return sign * ((abs * 2n + denominator) / (denominator * 2n));
}
export function quantity(e6: bigint): string {
  return new Decimal(e6.toString()).div(1_000_000).toFixed();
}
export function unitCost(cents: bigint, e6: bigint): string {
  return e6 === 0n ? '0' : new Decimal(cents.toString()).mul(10000).div(e6.toString()).toFixed(12);
}

export type PoolInput = {
  openingQuantityE6: number;
  openingCents: number;
  receipts: { quantityE6: number; netCents: number }[];
  issues: { id: number; documentId: number; quantityE6: number }[];
  actualQuantityE6?: number;
  adjustZeroQuantity: boolean;
};

/** 原 w_cb_hz：月末加权平均，累计分配差额留在后行，结存保留尾差。 */
export function calculatePool(input: PoolInput) {
  const openingQ = integer(input.openingQuantityE6);
  const openingA = integer(input.openingCents);
  if (openingQ < 0n || openingA < 0n) fail('NEGATIVE', '期初数量或金额不能为负');
  let receivedQ = 0n;
  let receivedA = 0n;
  for (const receipt of input.receipts) {
    const q = integer(receipt.quantityE6);
    const a = integer(receipt.netCents);
    if (q <= 0n || a < 0n) fail('RECEIPT', '入库数量必须为正，金额不能为负');
    receivedQ += q;
    receivedA += a;
  }
  const availableQ = openingQ + receivedQ;
  const availableA = openingA + receivedA;
  safe(availableQ);
  safe(availableA);
  let issuedQ = 0n;
  let issuedA = 0n;
  const lines = input.issues.map((issue) => {
    const q = integer(issue.quantityE6);
    if (q <= 0n) fail('ISSUE', '出库数量必须为正');
    issuedQ += q;
    if (issuedQ > availableQ) fail('NEGATIVE', '本月出库数量超过期初与入库数量，不能核算负库存');
    const cumulative = roundedRatio(availableA * issuedQ, availableQ);
    const cost = cumulative - issuedA;
    issuedA = cumulative;
    return {
      lineId: issue.id,
      documentId: issue.documentId,
      costCents: safe(cost),
      unitCost: unitCost(availableA, availableQ),
    };
  });
  const bookQ = availableQ - issuedQ;
  const actualQ = input.actualQuantityE6 == null ? bookQ : integer(input.actualQuantityE6);
  if (actualQ < 0n) fail('COUNT', '实盘数量不能为负，不能核算负库存');
  const countQ = actualQ - bookQ;
  const countA = countQ === 0n ? 0n : roundedRatio(availableA * countQ, availableQ);
  let closingA = availableA - issuedA + countA;
  let zeroA = 0n;
  if (actualQ === 0n && closingA !== 0n) {
    if (!input.adjustZeroQuantity)
      fail(
        'ZERO_QUANTITY',
        '产品结存数量为零但仍有金额',
        '勾选自动调整后重新试算；调整金额将单独列示',
      );
    zeroA = -closingA;
    closingA = 0n;
  }
  if (closingA < 0n) fail('NEGATIVE', '盘亏后结存金额为负，请核对实盘数量');
  return {
    receivedQuantity: quantity(receivedQ),
    receivedCents: safe(receivedA),
    issuedQuantity: quantity(issuedQ),
    issuedCents: safe(issuedA),
    unitCost: unitCost(availableA, availableQ),
    countDifference: quantity(countQ),
    countCents: safe(countA),
    zeroQuantityAdjustmentCents: safe(zeroA),
    closingQuantity: quantity(actualQ),
    closingCents: safe(closingA),
    closingQuantityE6: safe(actualQ),
    lines,
  };
}
