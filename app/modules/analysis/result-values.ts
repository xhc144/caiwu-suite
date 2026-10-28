import { Decimal } from 'decimal.js';
import { BusinessError } from '@caiwu/core';
import type { AnalysisSheet } from './custom';

function integer(value: Decimal): number {
  const amount = value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(amount))
    throw new BusinessError({
      code: 'ANALYSIS_AMOUNT_RANGE',
      message: '调整后的分析金额超出可保存范围',
      hint: '请缩小输入金额；当前输入仍保留',
    });
  return amount;
}
const total = (values: (number | null)[]) =>
  values.reduce<Decimal>((n, v) => n.plus(v ?? 0), new Decimal(0));
/** 对同一分析稿施加单元格调整；保留取数原值，累计与月均只增加本次差额。 */
export function applyResultValues(base: AnalysisSheet, values: (number | null)[][]): AnalysisSheet {
  const rows = base.rows.map((r, i) => {
    const edited = values[i]!;
    const difference = total(edited).minus(total(r.values));
    const averageNumerator = integer(new Decimal(r.averageNumerator).plus(difference));
    const last = base.source.kind === 'custom' || base.source.filter.metric === 'balance';
    return {
      ...r,
      values: edited,
      total: last ? edited.at(-1)! : integer(new Decimal(r.total).plus(difference)),
      averageNumerator,
      average: integer(new Decimal(averageNumerator).div(r.averageDivisor)),
    };
  });
  if (base.source.kind === 'trend') {
    const annual = base.source.filter.mode === 'annual';
    const denominator = total(rows.map((r) => (annual ? r.total : r.values[0]!)));
    rows.forEach((r) => {
      r.ratio = denominator.isZero()
        ? null
        : new Decimal(annual ? r.total : r.values[0]!).div(denominator).mul(100).toFixed(2);
    });
  }
  return { ...base, rows };
}
