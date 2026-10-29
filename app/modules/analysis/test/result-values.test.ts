import { describe, expect, it } from 'vitest';
import { sheetFromTrend } from '../server/custom';
import {
  applyResultValues,
  formatAnalysisValue,
  parseAnalysisValue,
  resultChartData,
} from '../result-values';
import fc from 'fast-check';
import type { TrendReport } from '../shared';
const report = (): TrendReport => ({
  filter: {
    accountCode: '1122',
    period: 202602,
    mode: 'monthly',
    metric: 'balance',
    scope: 'ledger',
    includeUnposted: false,
  },
  generatedAt: '2026-02-28T00:00:00Z',
  startPeriod: 202601,
  activeMonths: 2,
  denominator: 20000,
  rows: [
    {
      accountCode: '1122',
      accountName: '应收账款',
      direction: 'debit',
      months: [10000, 20000, ...Array<number | null>(10).fill(null)],
      current: 20000,
      ytd: 20000,
      average: 15000,
      ratio: '100.00',
      ledgerCurrent: 20000,
      pnlAdjustment: 0,
    },
  ],
});
describe('w_fx_nd_1 / w_fx_yd_1 结果调整计算', () => {
  it('w_fx_nd_1 年中启用原值空白和未完成输入不绘成零，真实零仍保留', () => {
    const r = report();
    r.filter.mode = 'annual';
    r.startPeriod = 202603;
    r.rows[0]!.months = [null, null, 12345, ...Array<number>(9).fill(0)];
    const sheet = sheetFromTrend(r);
    const values = sheet.rows.map((row) =>
      row.values.map((v) => (v === null ? null : formatAnalysisValue(v))),
    );
    values[0]![0] = '999.00';
    values[0]![3] = '1.234';
    const chart = resultChartData(sheet, values);
    expect(chart.labels).not.toContain('202601');
    expect(chart.labels).not.toContain('202602');
    expect(chart.labels).not.toContain('202604');
    expect(chart.labels[0]).toBe('202603');
    expect(chart.values[0]).toBe(12345);
    expect(chart.labels).toContain('202605');
    expect(chart.values[chart.labels.indexOf('202605')]).toBe(0);
    expect(sheet.rows[0]!.originalValues.slice(0, 3)).toEqual([null, null, 12345]);
  });
  it('六位数量与两位金额的任意安全整数精确显示后可回读，不接受小数超位或溢出', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom(2 as const, 6 as const),
        (value, places) => {
          expect(parseAnalysisValue(formatAnalysisValue(value, places), places)).toBe(value);
        },
      ),
    );
    expect(parseAnalysisValue('1.234567', 6)).toBe(1234567);
    expect(parseAnalysisValue('1.234567', 2)).toBeNull();
    expect(parseAnalysisValue('1.2345678', 6)).toBeNull();
    expect(parseAnalysisValue('9007199254.740992', 6)).toBeNull();
  });
  it('月度余额编辑保留前月平均基础，连续保存调整不会丢失历史月份', () => {
    const sheet = sheetFromTrend(report());
    const updated = applyResultValues(sheet, [[30000]]);
    expect(updated.rows[0]).toMatchObject({
      total: 30000,
      average: 20000,
      originalValues: [20000],
    });
    const again = applyResultValues(updated, [[40000]]);
    expect(again.rows[0]).toMatchObject({ total: 40000, average: 25000, originalValues: [20000] });
    expect(sheet.rows[0]!.values).toEqual([20000]);
  });
  it('年度编辑与取数原值没有数组别名；累计发生额保留期初累计差额', () => {
    const original = report();
    original.filter.mode = 'annual';
    original.filter.metric = 'debit';
    original.rows[0]!.ytd = 35000;
    original.rows[0]!.months = [10000, 20000, ...Array<number>(10).fill(0)];
    const sheet = sheetFromTrend(original);
    const values = [...sheet.rows[0]!.values];
    values[0] = 12000;
    const updated = applyResultValues(sheet, [values]);
    expect(updated.rows[0]).toMatchObject({ total: 37000, average: 3083, ratio: '100.00' });
    expect(updated.rows[0]!.originalValues[0]).toBe(10000);
  });
  it('零分母明确无法计算；超范围金额阻止而不修改基准', () => {
    const sheet = sheetFromTrend(report());
    expect(applyResultValues(sheet, [[0]]).rows[0]!.ratio).toBeNull();
    sheet.rows[0]!.averageNumerator = Number.MAX_SAFE_INTEGER;
    expect(() => applyResultValues(sheet, [[30000]])).toThrow('超出');
    expect(sheet.rows[0]!.values).toEqual([20000]);
  });
});
