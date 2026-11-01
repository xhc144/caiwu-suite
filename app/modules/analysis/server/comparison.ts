import { Decimal } from 'decimal.js';
import ExcelJS from 'exceljs';
import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  ComparisonFilterSchema,
  comparisonValueText,
  METHOD_NAMES,
  periodAt,
  periodIndex,
  type ComparisonCell,
  type ComparisonColumn,
  type ComparisonFilter,
  type ComparisonReport,
} from '../comparison';
import type { AnalysisSheet } from '../custom';
import { definitionService } from './custom';

const Exact = Decimal.clone({ precision: 80 });
function safeAmount(value: Decimal) {
  const number = value.toNumber();
  if (!Number.isSafeInteger(number))
    throw new BusinessError({
      code: 'ANALYSIS_AMOUNT_OVERFLOW',
      message: '分析金额超过可计算范围',
      hint: '请缩小期间范围，或改用末期值后重试',
    });
  return number === 0 ? 0 : number;
}
function percentages(
  amount: number | null,
  baseline: number | null,
  decimalPlaces = 2,
  baselinePlaces = decimalPlaces,
): ComparisonCell {
  if (amount === null || baseline === null)
    return { amount, ratio: null, growth: null, reason: '基期或报告期早于账套启用期间' };
  if (baseline === 0)
    return { amount, ratio: null, growth: null, reason: '基数为零，无法计算比例' };
  const current = new Exact(amount).div(new Exact(10).pow(decimalPlaces));
  const base = new Exact(baseline).div(new Exact(10).pow(baselinePlaces));
  return {
    amount,
    ratio: current.div(base).mul(100).toFixed(2),
    growth: current.minus(base).div(base).mul(100).toFixed(2),
    reason: null,
  };
}
/** 季、年按完整自然区间展开；合计与末期值由用户显式选择，不猜测公式性质。 */
export function comparisonColumns(raw: ComparisonFilter): ComparisonColumn[] {
  const f = ComparisonFilterSchema.parse(raw);
  if (f.method === 'structure')
    return [{ label: String(f.periodTo), periodFrom: f.periodTo, periodTo: f.periodTo }];
  if (f.method === 'comparison') {
    const baseline = f.comparison === 'previousYear' ? f.periodTo - 100 : f.baselinePeriod!;
    return [
      { label: `基期 ${baseline}`, periodFrom: baseline, periodTo: baseline },
      { label: `报告期 ${f.periodTo}`, periodFrom: f.periodTo, periodTo: f.periodTo },
    ];
  }
  const width = f.granularity === 'year' ? 12 : f.granularity === 'quarter' ? 3 : 1;
  const from = Math.floor(periodIndex(f.periodFrom) / width) * width;
  const to = Math.floor(periodIndex(f.periodTo) / width) * width;
  if (to - from + width > 36)
    throw new BusinessError({
      code: 'ANALYSIS_PERIOD_RANGE',
      message: '完整季或年展开后超过36个月',
      hint: '请缩小起止期间后重试',
    });
  return Array.from({ length: (to - from) / width + 1 }, (_, i) => {
    const first = periodAt(from + i * width),
      last = periodAt(from + (i + 1) * width - 1);
    return {
      label:
        width === 12
          ? `${Math.trunc(first / 100)}年`
          : width === 3
            ? `${Math.trunc(first / 100)}年第${Math.ceil((first % 100) / 3)}季`
            : String(first),
      periodFrom: first,
      periodTo: last,
    };
  });
}

export function comparisonService(svc: CoreServices) {
  return {
    async calculate(raw: ComparisonFilter): Promise<ComparisonReport> {
      svc.permissions.require('analysis.view');
      const f = ComparisonFilterSchema.parse(raw);
      return svc.tx(async (t) => {
        const definition = await definitionService(t).get(f.definitionId);
        const columns = comparisonColumns(f);
        const start = (await t.book.info()).startPeriod;
        const required = new Set<number>();
        const wanted = [...columns];
        if (f.method === 'trend' && f.trendMode === 'chain') {
          const first = columns[0]!;
          const width = periodIndex(first.periodTo) - periodIndex(first.periodFrom) + 1;
          wanted.unshift({
            label: '前一期',
            periodFrom: periodAt(periodIndex(first.periodFrom) - width),
            periodTo: periodAt(periodIndex(first.periodFrom) - 1),
          });
        }
        for (const c of wanted)
          if (f.aggregation === 'ending' || f.method !== 'trend') {
            if (c.periodTo >= start) required.add(c.periodTo);
          } else
            for (let i = periodIndex(c.periodFrom); i <= periodIndex(c.periodTo); i++) {
              const p = periodAt(i);
              if (p >= start) required.add(p);
            }
        // 只读取有来源的月份；启用前保留空值。每次计算不超过既有36个月限制。
        const months = [...required].sort((a, b) => a - b);
        const matrix = new Map<number, AnalysisSheet['rows']>();
        for (let offset = 0; offset < months.length;) {
          const from = months[offset]!;
          let end = offset;
          while (
            end + 1 < months.length &&
            periodIndex(months[end + 1]!) === periodIndex(months[end]!) + 1 &&
            end - offset < 35
          )
            end++;
          const sheet = await definitionService(t).calculate({
            definitionId: f.definitionId,
            periodFrom: from,
            periodTo: months[end]!,
            scope: f.scope,
            includeUnposted: f.includeUnposted,
          });
          sheet.periods.forEach((p, j) =>
            matrix.set(
              p,
              sheet.rows.map((r) => ({
                ...r,
                values: [r.values[j]!],
                originalValues: [r.originalValues[j]!],
              })),
            ),
          );
          offset = end + 1;
        }
        const value = (rowKey: string, column: ComparisonColumn): number | null => {
          const last = matrix.get(column.periodTo)?.find((r) => r.key === rowKey)?.values[0];
          if (f.aggregation === 'ending' || f.method !== 'trend') return last ?? null;
          if (column.periodFrom < start) return null;
          let amount = new Exact(0);
          for (let i = periodIndex(column.periodFrom); i <= periodIndex(column.periodTo); i++) {
            const n = matrix.get(periodAt(i))?.find((r) => r.key === rowKey)?.values[0];
            if (n === undefined || n === null) return null;
            amount = amount.plus(n);
          }
          return safeAmount(amount);
        };
        const denominator = definition.rows.find((r) => r.key === f.denominatorKey);
        if (f.method === 'structure' && !denominator)
          throw new BusinessError({
            code: 'ANALYSIS_BASE_PROJECT',
            message: '结构分析的基数项目不存在',
            hint: '请重新选择分析表及基数项目后再分析',
          });
        const rows = definition.rows.map((r) => {
          const key = String(r.key);
          const amounts = columns.map((c) => value(key, c));
          const cells = amounts.map((amount, index): ComparisonCell => {
            if (f.method === 'structure') {
              if (r.unit !== denominator!.unit)
                return {
                  amount,
                  ratio: null,
                  growth: null,
                  reason: '项目与基数单位不同，无法计算占比',
                };
              const result = percentages(
                amount,
                value(String(denominator!.key), columns[0]!),
                r.decimalPlaces ?? 2,
                denominator!.decimalPlaces ?? 2,
              );
              return { ...result, growth: null };
            }
            if (f.method === 'comparison' && index === 1) return percentages(amount, amounts[0]!);
            if (f.method === 'trend' && f.trendMode !== 'absolute') {
              const baseline =
                f.trendMode === 'fixed'
                  ? amounts[0]!
                  : index > 0
                    ? amounts[index - 1]!
                    : value(key, wanted[0]!);
              return percentages(amount, baseline);
            }
            return {
              amount,
              ratio: null,
              growth: null,
              reason: amount === null ? '早于账套启用期间，缺少完整来源' : null,
            };
          });
          return {
            key,
            name: r.name,
            unit: r.unit,
            subtotal: r.subtotal,
            decimalPlaces: r.decimalPlaces ?? 2,
            cells,
            difference:
              f.method === 'comparison' && amounts[0] !== null && amounts[1] !== null
                ? safeAmount(new Exact(amounts[1]!).minus(amounts[0]!))
                : null,
          };
        });
        return {
          title: `${definition.code} ${definition.name} · ${METHOD_NAMES[f.method]}`,
          generatedAt: t.ctx.now().toISOString(),
          definitionRevision: definition.revision,
          filter: f,
          columns,
          rows,
          note: `使用同一账务快照逐月计算定义公式。${
            f.method === 'trend'
              ? `季、年按完整自然区间展开；区间取数为${f.aggregation === 'ending' ? '末月值，不累加余额或比例' : '逐月计算结果之和，适用于发生额；余额及比例请改选末期值'}。`
              : '结构与比较按所选报告月份取数。'
          }占比或指数=报告数÷基数×100%；增减率=(报告数−基数)÷基数×100%；定基使用区间第一期，环比使用前一完整期间。基数为零时保留金额并说明无法计算；启用前无来源的金额和比例留空。${f.includeUnposted ? '含未过账。' : '仅已过账。'}${f.scope === 'operating' ? '经营口径排除各报告年度损益结转。' : '原始总账口径。'}`,
        };
      });
    },
    async export(raw: ComparisonFilter) {
      svc.permissions.require('analysis.export');
      const report = await this.calculate(raw);
      return { report, base64: await exportComparison(report) };
    },
  };
}

export async function exportComparison(report: ComparisonReport) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('分析方法结果');
  sheet.addRow([report.title]);
  sheet.addRow([report.generatedAt, report.note]);
  sheet.addRow([
    '项目编号',
    '项目',
    '单位',
    ...report.columns.flatMap((c) => [
      `${c.label}数值`,
      `${c.label}占比或指数%`,
      `${c.label}增减率%`,
      `${c.label}说明`,
    ]),
    '报告比基期增减',
  ]);
  const units = { money: '元', percent: '%', number: '数值' };
  for (const row of report.rows)
    sheet.addRow([
      row.key,
      row.name,
      units[row.unit],
      ...row.cells.flatMap((cell) => [
        cell.amount === null ? null : comparisonValueText(cell.amount, row.decimalPlaces),
        cell.ratio,
        cell.growth,
        cell.reason,
      ]),
      row.difference === null ? null : comparisonValueText(row.difference, row.decimalPlaces),
    ]);
  sheet.getRow(3).font = { bold: true };
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 3 }];
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  // 金额和比例以精确文本保存，避免 Excel 大数失去末位。
  for (let i = 4; i <= sheet.columnCount; i++) sheet.getColumn(i).numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}
