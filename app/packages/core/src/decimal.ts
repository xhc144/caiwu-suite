import DecimalJs from 'decimal.js';

/**
 * 十进制运算。汇率、单价、数量、比例一律用它，按字符串存储和传输。
 * 精度 40 位，舍入方式四舍五入。
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = DecimalJs;

/** 是否是合法的十进制数字字符串（可带负号）。 */
export function isDecimalString(value: string): boolean {
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(value.trim());
}

/** 规范化十进制字符串：去掉多余的 0。"1.2300" → "1.23"，"-0" → "0"。 */
export function normalizeDecimal(value: string | number | Decimal): string {
  const d = new Decimal(value);
  return d.isZero() ? '0' : d.toFixed();
}

// ---------------------------------------------------------------- 数量

/**
 * 数量在数据库里按"百万分之一"存成整数（列名带 `_e6` 后缀），保证求和精确。
 * 接口上传字符串，例如 "12.5"。最多 6 位小数，超出部分四舍五入。
 */
export const QTY_SCALE = 1_000_000;

export function qtyToE6(value: string | number | Decimal): number {
  const n = new Decimal(value).mul(QTY_SCALE).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(n)) throw new RangeError(`数量超出范围：${String(value)}`);
  return n;
}

export function qtyFromE6(value: number): string {
  return normalizeDecimal(new Decimal(value).div(QTY_SCALE));
}
