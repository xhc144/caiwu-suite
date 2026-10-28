import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import analysis from '../server';
import {
  ComparisonFilterSchema,
  comparisonValueText,
  periodAt,
  periodIndex,
  type ComparisonFilter,
} from '../comparison';
import { comparisonColumns, comparisonService, exportComparison } from '../server/comparison';
import { definitionService } from '../server/custom';

let app: TestApp;
let id: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis], startYear: 2025 });
  await app.svc.periods.ensureYear(2026);
  const definition = await definitionService(app.svcFor('analysis')).save({
    code: '101',
    name: '合成比较分析',
    expectedRevision: 0,
    rows: [
      { key: 1, name: '应收发生', formula: '借方("1122")', unit: 'money' },
      { key: 2, name: '两倍发生', formula: '项目(1) * 2', subtotal: true, unit: 'money' },
      { key: 3, name: '独立比例', formula: '50', unit: 'percent' },
    ],
  });
  id = definition.id;
  const values = [
    ['2025-01-10', 10000],
    ['2025-02-10', 20000],
    ['2025-03-10', 30000],
    ['2025-12-10', 40000],
    ['2026-01-10', 25000],
    ['2026-02-10', 50000],
    ['2026-03-10', 75000],
    ['2026-04-10', 100000],
    ['2026-05-10', 125000],
    ['2026-06-10', 150000],
  ] as const;
  await seedVouchers(
    app.svc,
    values.map(([date, amount]) => ({
      date,
      status: 'posted',
      lines: [
        { account: '1122', debit: amount, dims: { partner: 'C001' } },
        { account: '6001', credit: amount },
      ],
    })),
  );
});
afterEach(async () => {
  await app?.close();
});

const filter = (extra: Partial<ComparisonFilter> = {}): ComparisonFilter => ({
  definitionId: id,
  method: 'trend',
  periodFrom: 202601,
  periodTo: 202602,
  ...extra,
});
const service = () => comparisonService(app.svcFor('analysis'));

describe('w_fx_1 真实公式结果的结构、比较与趋势', () => {
  it('结构占比显式选基数，同单位计算，不混合金额和比例', async () => {
    const report = await service().calculate(filter({ method: 'structure', denominatorKey: 2 }));
    expect(report.columns).toEqual([{ label: '202602', periodFrom: 202602, periodTo: 202602 }]);
    expect(report.rows[0]!.cells[0]).toMatchObject({ amount: 50000, ratio: '50.00', growth: null });
    expect(report.rows[1]!.cells[0]!.ratio).toBe('100.00');
    expect(report.rows[2]!.cells[0]).toMatchObject({
      amount: 5000,
      ratio: null,
      reason: '项目与基数单位不同，无法计算占比',
    });
    await expect(
      service().calculate(filter({ method: 'structure', denominatorKey: 99 })),
    ).rejects.toThrow('基数项目不存在');
    await expect(service().calculate(filter({ method: 'structure' }))).rejects.toThrow('基数项目');
  });
  it('与上年同期及指定基期比较，差额、指数和增减率分别核对', async () => {
    const report = await service().calculate(filter({ method: 'comparison', periodTo: 202601 }));
    expect(report.rows[0]!.cells.map((c) => c.amount)).toEqual([10000, 25000]);
    expect(report.rows[0]).toMatchObject({ difference: 15000 });
    expect(report.rows[0]!.cells[1]).toMatchObject({
      ratio: '250.00',
      growth: '150.00',
      reason: null,
    });
    const specified = await service().calculate(
      filter({
        method: 'comparison',
        periodTo: 202601,
        comparison: 'specified',
        baselinePeriod: 202502,
      }),
    );
    expect(specified.rows[0]).toMatchObject({ difference: 5000 });
    expect(specified.rows[0]!.cells[1]).toMatchObject({ ratio: '125.00', growth: '25.00' });
  });
  it('绝对、定基、环比逐月结果，第一期环比真实读取区间前月', async () => {
    const absolute = await service().calculate(filter());
    expect(absolute.rows[0]!.cells.map((c) => c.amount)).toEqual([25000, 50000]);
    const fixed = await service().calculate(filter({ trendMode: 'fixed' }));
    expect(fixed.rows[0]!.cells.map((c) => c.ratio)).toEqual(['100.00', '200.00']);
    expect(fixed.rows[0]!.cells.map((c) => c.growth)).toEqual(['0.00', '100.00']);
    const chain = await service().calculate(filter({ trendMode: 'chain' }));
    expect(chain.rows[0]!.cells.map((c) => c.ratio)).toEqual(['62.50', '200.00']);
    expect(chain.rows[0]!.cells.map((c) => c.growth)).toEqual(['-37.50', '100.00']);
  });
  it('季度按自然区间展开，末期与合计显式区分，公式项目保持一致', async () => {
    const report = await service().calculate(
      filter({
        periodFrom: 202602,
        periodTo: 202604,
        granularity: 'quarter',
        aggregation: 'sum',
        trendMode: 'fixed',
      }),
    );
    expect(report.columns).toEqual([
      { label: '2026年第1季', periodFrom: 202601, periodTo: 202603 },
      { label: '2026年第2季', periodFrom: 202604, periodTo: 202606 },
    ]);
    expect(report.rows[0]!.cells.map((c) => c.amount)).toEqual([150000, 375000]);
    expect(report.rows[1]!.cells.map((c) => c.amount)).toEqual([300000, 750000]);
    expect(report.rows[0]!.cells.map((c) => c.ratio)).toEqual(['100.00', '250.00']);
    const ending = await service().calculate(
      filter({ periodTo: 202606, granularity: 'quarter', aggregation: 'ending' }),
    );
    expect(ending.rows[0]!.cells.map((c) => c.amount)).toEqual([75000, 150000]);
  });
  it('年度合计和末期值分别使用完整年度的真实月份', async () => {
    const report = await service().calculate(
      filter({ periodFrom: 202501, periodTo: 202612, granularity: 'year', aggregation: 'sum' }),
    );
    expect(report.rows[0]!.cells.map((c) => c.amount)).toEqual([100000, 525000]);
    const ending = await service().calculate(
      filter({ periodFrom: 202501, periodTo: 202612, granularity: 'year' }),
    );
    expect(ending.rows[0]!.cells.map((c) => c.amount)).toEqual([40000, 0]);
  });
  it('w_fx_demo 基数零保留金额、明确无法计算，不输出无穷大', async () => {
    const report = await service().calculate(
      filter({ method: 'comparison', comparison: 'specified', baselinePeriod: 202504 }),
    );
    expect(report.rows[0]!.cells[1]).toEqual({
      amount: 50000,
      ratio: null,
      growth: null,
      reason: '基数为零，无法计算比例',
    });
    expect(report.rows[0]!.difference).toBe(50000);
  });
  it('含未过账开关使用真实凭证状态，不改变已过账口径', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-01-20',
        status: 'pending',
        lines: [
          { account: '1122', debit: 1000, dims: { partner: 'C001' } },
          { account: '6001', credit: 1000 },
        ],
      },
    ]);
    expect((await service().calculate(filter())).rows[0]!.cells[0]!.amount).toBe(25000);
    expect(
      (await service().calculate(filter({ includeUnposted: true }))).rows[0]!.cells[0]!.amount,
    ).toBe(26000);
  });
  it('导出和屏幕使用同一快照，金额、零基数说明完整保留', async () => {
    const report = await service().calculate(
      filter({ method: 'comparison', comparison: 'specified', baselinePeriod: 202504 }),
    );
    const bytes = await exportComparison(report);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(bytes, 'base64')).buffer);
    const row = workbook.worksheets[0]!.getRow(4).values;
    expect(row).toContain('500.00');
    expect(row).toContain('基数为零，无法计算比例');
    expect(row).toContain('0.00');
    const result = await service().export(filter());
    expect(result.report.rows[0]!.cells[0]!.amount).toBe(25000);
  });
  it('服务端独立执行查看权限；无权限不能取数或导出', async () => {
    const token = await app.addUser('forbidden');
    const core = app.call(analysis, token);
    await expect(core.comparison.calculate(filter())).rejects.toThrow();
    await expect(core.comparison.export(filter())).rejects.toThrow();
  });
});

describe('w_fx_1 缺少历史来源', () => {
  it('启用前基期未知，报告数仍保留，不能把历史当作零', async () => {
    const report = await service().calculate(
      filter({ method: 'comparison', periodTo: 202501, periodFrom: 202501 }),
    );
    expect(report.rows[0]!.cells[0]!.amount).toBeNull();
    expect(report.rows[0]!.cells[1]).toMatchObject({ amount: 10000, ratio: null, growth: null });
    expect(report.rows[0]!.difference).toBeNull();
    expect(report.rows[0]!.cells[1]!.reason).toContain('启用期间');
  });
  it('跨启用前的季度合计保持未知；末期值仅用有来源的末月', async () => {
    const late = await createTestApp({ modules: [analysis], startYear: 2026, startMonth: 2 });
    try {
      const def = await definitionService(late.svcFor('analysis')).save({
        code: '1',
        name: '中途启用',
        expectedRevision: 0,
        rows: [{ key: 1, name: '固定数', formula: '1', unit: 'money' }],
      });
      const svc = comparisonService(late.svcFor('analysis'));
      const query = {
        definitionId: def.id,
        periodFrom: 202601,
        periodTo: 202603,
        granularity: 'quarter' as const,
      };
      expect(
        (await svc.calculate({ ...query, aggregation: 'sum' })).rows[0]!.cells[0]!.amount,
      ).toBeNull();
      expect(
        (await svc.calculate({ ...query, aggregation: 'ending' })).rows[0]!.cells[0]!.amount,
      ).toBe(100);
    } finally {
      await late.close();
    }
  });
  it('日期边界、倒序、缺基期和展开超过36个月均被阻止', () => {
    expect(ComparisonFilterSchema.safeParse(filter({ periodFrom: 202613 })).success).toBe(false);
    expect(ComparisonFilterSchema.safeParse(filter({ periodFrom: 202603 })).success).toBe(false);
    expect(
      ComparisonFilterSchema.safeParse(filter({ method: 'comparison', comparison: 'specified' }))
        .success,
    ).toBe(false);
    expect(() =>
      comparisonColumns(filter({ periodFrom: 202502, periodTo: 202801, granularity: 'quarter' })),
    ).toThrow('超过36个月');
  });
  it('月份索引转换覆盖跨年边界', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          expect(periodAt(periodIndex(year * 100 + month))).toBe(year * 100 + month);
        },
      ),
    );
  });
  it('六位数值保持整数精度，结构占比按各项目的精度换算', async () => {
    const def = await definitionService(app.svcFor('analysis')).save({
      code: '109',
      name: '精确数量',
      expectedRevision: 0,
      rows: [
        { key: 1, name: '六位数量', formula: '1.234567', unit: 'number', decimalPlaces: 6 },
        { key: 2, name: '两位基数', formula: '2', unit: 'number', decimalPlaces: 2 },
      ],
    });
    const report = await service().calculate(
      filter({ definitionId: def.id, method: 'structure', denominatorKey: 2 }),
    );
    expect(report.rows[0]!.decimalPlaces).toBe(6);
    expect(report.rows[0]!.cells[0]).toMatchObject({ amount: 1234567, ratio: '61.73' });
    expect(comparisonValueText(report.rows[0]!.cells[0]!.amount!, 6)).toBe('1.234567');
    expect(comparisonValueText(-1, 6)).toBe('-0.000001');
    expect(comparisonValueText(Number.MAX_SAFE_INTEGER, 6)).toBe('9007199254.740991');
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.constantFrom(2 as const, 6 as const),
        (value, scale) => {
          expect(BigInt(comparisonValueText(value, scale).replace('.', ''))).toBe(BigInt(value));
        },
      ),
    );
  });
  it('季度金额合计超出安全整数时拒绝，不舍入成错误金额', async () => {
    const def = await definitionService(app.svcFor('analysis')).save({
      code: '110',
      name: '金额边界',
      expectedRevision: 0,
      rows: [{ key: 1, name: '大金额', formula: '45035996273704.95', unit: 'money' }],
    });
    await expect(
      service().calculate(
        filter({
          definitionId: def.id,
          periodTo: 202603,
          granularity: 'quarter',
          aggregation: 'sum',
        }),
      ),
    ).rejects.toThrow('超过');
  });
});
