import { wrapPrintText } from '@caiwu/print';

/** 展示行的借贷毛额可以超过单笔金额安全范围，打印累计仍逐分保留。 */
export function printCents(value: bigint, thousands = false): string {
  const abs = value < 0n ? -value : value;
  const whole = String(abs / 100n);
  return `${value < 0n ? '-' : ''}${thousands ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole}.${String(abs % 100n).padStart(2, '0')}`;
}

/** 金额和数量整值留在同一格，必要时缩小字体；长名称按视觉行拆分。 */
export function printText(text: string, widthMm: number, fontSize: number, numeric = false) {
  if (!numeric) return { lines: wrapPrintText(text, widthMm, fontSize), fontSize };
  const size = Math.min(fontSize, (widthMm - 3) / Math.max(1, text.length) / 0.24);
  if (size < 3) throw new Error('打印金额或数量过长，请扩大纸张或减少同页列数');
  return { lines: [text], fontSize: size };
}
