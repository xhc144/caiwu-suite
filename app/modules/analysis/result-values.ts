import { Decimal } from 'decimal.js';
import { BusinessError } from '@caiwu/core';
import type { AnalysisSheet } from './custom';

export function formatAnalysisValue(
  value: number | null | undefined,
  decimalPlaces: 2 | 6 = 2,
): string {
  if (value == null) return '未知';
  return new Decimal(value).div(new Decimal(10).pow(decimalPlaces)).toFixed(decimalPlaces);
}
export function parseAnalysisValue(value: string, decimalPlaces: 2 | 6 = 2): number | null {
  if (!new RegExp(`^-?\\d+(?:\\.\\d{1,${decimalPlaces}})?$`).test(value.trim())) return null;
  const number = new Decimal(value.trim()).mul(new Decimal(10).pow(decimalPlaces)).toNumber();
  return Number.isSafeInteger(number) ? number : null;
}

/** 图形只取有来源且当前输入有效的金额；启用前及坏输入不补成零。 */
export function resultChartData(sheet: AnalysisSheet, values: (string | null)[][]) {
  const index = sheet.rows.findIndex((row) => row.unit === 'money' && !row.subtotal);
  const row = sheet.rows[index];
  const points: { label: string; value: number }[] = [];
  if (row)
    sheet.periods.forEach((period, j) => {
      if (row.values[j] == null) return;
      const text = values[index]?.[j];
      if (text == null) return;
      const value = parseAnalysisValue(text, row.decimalPlaces);
      if (value !== null) points.push({ label: String(period), value });
    });
  return { labels: points.map((p) => p.label), values: points.map((p) => p.value) };
}

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
