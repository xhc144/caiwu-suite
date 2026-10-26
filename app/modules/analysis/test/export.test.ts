import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { Cell, Workbook } from 'exceljs';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import type { AgingReport, TrendReport } from '../shared';
import analysis from '../server';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis] });
});
afterEach(async () => app.close());

/** 期望值独立用整数分构造，不复用导出的格式化函数或浮点元换算。 */
function exactYuan(cents: number): string {
  const n = BigInt(cents);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
async function readXlsx(base64: string): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(base64, 'base64')).buffer);
  return wb;
}
function expectMoney(cell: Cell, cents: number) {
  const exact = exactYuan(cents);
  if (Math.abs(cents) > 999_999_999_999_999) {
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe(exact);
    expect(cell.numFmt).toBe('@');
  } else {
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    const value = cell.value as number;
    expect(value.toFixed(2)).toBe(exact);
    // 还原成 Excel 的15位有效数字后，普通金额仍须逐分不变。
    expect(Number(value.toPrecision(15)).toFixed(2)).toBe(exact);
  }
  expect(cell.formula).toBeUndefined();
}
function checkAging(wb: Workbook, report: AgingReport) {
  const sheet = wb.getWorksheet('账龄分析')!;
  const values = (r: {
    buckets: number[];
    unaged: number;
    future: number;
    reverse: number;
    closing: number;
  }) => [...r.buckets, r.unaged, r.future, r.reverse, r.closing];
  report.rows.forEach((row, i) =>
    values(row).forEach((n, j) => expectMoney(sheet.getCell(i + 5, j + 5), n)),
  );
  values(report.totals).forEach((n, j) =>
    expectMoney(sheet.getCell(report.rows.length + 5, j + 5), n),
  );
  const control = wb.getWorksheet('总账核对')!;
  report.controls.forEach((row, i) =>
    [row.allocated, row.ledger, row.difference].forEach((n, j) =>
      expectMoney(control.getCell(i + 2, j + 3), n),
    ),
  );
}
function checkTrend(wb: Workbook, report: TrendReport) {
  const sheet = wb.getWorksheet('科目分析')!;
  expectMoney(sheet.getCell('D2'), report.denominator);
  const count = report.filter.mode === 'annual' ? 12 : 1;
  report.rows.forEach((row, i) => {
    const months = report.filter.mode === 'annual' ? row.months : [row.current];
    months.forEach((n, j) => {
      const cell = sheet.getCell(i + 4, j + 3);
      if (n == null) expect(cell.value).toBe('早于启用 / 未查询');
      else expectMoney(cell, n);
    });
    expectMoney(sheet.getCell(i + 4, count + 3), row.ytd);
    expectMoney(sheet.getCell(i + 4, count + 4), row.average);
    expectMoney(sheet.getCell(i + 4, count + 6), row.ledgerCurrent);
    expectMoney(sheet.getCell(i + 4, count + 7), row.pnlAdjustment);
  });
}
async function post(amount: number, account = '1122', partner = 'C001', bizDate?: string) {
  const spec = {
    date: '2026-12-31',
    status: 'posted' as const,
    lines:
      amount > 0
        ? [
            { account, debit: amount, dims: { partner } },
            { account: '6001', credit: amount },
          ]
        : [
            { account, credit: -amount, dims: { partner } },
            { account: '6001', debit: -amount },
          ],
  };
  if (!bizDate) {
    await seedVouchers(app.svc, [spec]);
    return;
  }
  const input = await voucherInputFromSpec(app.svc, spec);
  const voucher = await app.svc.vouchers.create({
    ...input,
    lines: input.lines.map((l, i) => ({ ...l, bizDate: i === 0 ? bizDate : null })),
  });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
}
const agingFilter = { accountCode: '1122', cutoff: '2026-12-31', bounds: [0], hideZero: false };

describe('w_fx_zl / w_fx_km Excel真实生成及回读金额精度', () => {
  it.each([
    ['审查复现正值', 9_000_000_000_000_001],
    ['审查复现负值', -9_000_000_000_000_001],
    ['安全整数最大值', Number.MAX_SAFE_INTEGER],
    ['安全整数最小值', Number.MIN_SAFE_INTEGER],
    ['数值范围上界', 999_999_999_999_999],
    ['数值范围负上界', -999_999_999_999_999],
    ['数值范围之外正值', 1_000_000_000_000_000],
    ['数值范围之外负值', -1_000_000_000_000_000],
    ['普通正金额', 12345],
    ['普通负金额', -12345],
    ['正一分', 1],
    ['负一分', -1],
  ] as const)('%s：账龄、合计、核对金额及年度/月度金额和分母逐分不变', async (_, amount) => {
    await post(amount);
    const api = app.call(analysis);
    const aging = await api.exportAging(agingFilter);
    expect(aging.report.totals.closing).toBe(amount);
    checkAging(await readXlsx(aging.base64), aging.report);
    for (const mode of ['annual', 'monthly'] as const) {
      const trend = await api.exportTrend({
        accountCode: '1122',
        period: 202612,
        mode,
        metric: 'balance',
      });
      expect(trend.report.denominator).toBe(amount);
      checkTrend(await readXlsx(trend.base64), trend.report);
    }
  });
  it('零金额和零分母保留数值0，无法计算比例仍为说明文本', async () => {
    const api = app.call(analysis);
    const aging = await api.exportAging(agingFilter);
    checkAging(await readXlsx(aging.base64), aging.report);
    const trend = await api.exportTrend({ accountCode: '1122', period: 202612, mode: 'monthly' });
    const wb = await readXlsx(trend.base64);
    checkTrend(wb, trend.report);
    expect(wb.getWorksheet('科目分析')!.getCell('F4').value).toBe('无法计算：基数为零');
  });
  it.each([
    ['正期初未分龄', 'opening', 9_000_000_000_000_001],
    ['负期初未分龄', 'opening', -9_000_000_000_000_001],
    ['正未来业务日期', 'future', 9_000_000_000_000_001],
    ['负未来业务日期', 'future', -9_000_000_000_000_001],
  ] as const)('%s的大额单元格也保留精确文本', async (_, source, amount) => {
    const accountCode = amount < 0 ? '2202' : '1122';
    const partner = amount < 0 ? 'S001' : 'C001';
    if (source === 'opening')
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require(accountCode)).id,
        dimensions: { partner: (await app.svc.dimensions.getByCode('partner', partner))!.id },
        balance: amount,
      });
    else await post(amount, accountCode, partner, '2027-01-01');
    const result = await app.call(analysis).exportAging({
      ...agingFilter,
      accountCode,
      direction: amount < 0 ? 'payable' : 'receivable',
    });
    expect(result.report.rows[0]![source === 'opening' ? 'unaged' : 'future']).toBe(amount);
    checkAging(await readXlsx(result.base64), result.report);
  });
  it.each([
    '=1+1',
    '+SUM(A1:A2)',
    '-1+2',
    '@SUM(A1:A2)',
    '=HYPERLINK("https://example.invalid","点我")',
  ])('用户名称 %s 在真实XLSX中是原样文本，不是公式或超链接', async (name) => {
    await app.svc.accounts.create(
      { code: '9900', name, categoryId: 'asset', dimensions: [{ type: 'partner' }] },
      app.book.codeScheme,
    );
    await post(12345, '9900');
    const api = app.call(analysis);
    const aging = await api.exportAging({ ...agingFilter, accountCode: '9900' });
    const trend = await api.exportTrend({ accountCode: '9900', period: 202612, mode: 'monthly' });
    for (const [base64, sheetName, cellName] of [
      [aging.base64, '账龄分析', 'B5'],
      [trend.base64, '科目分析', 'B4'],
    ] as const) {
      const wb = await readXlsx(base64);
      const cell = wb.getWorksheet(sheetName)!.getCell(cellName);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.value).toBe(name);
      expect(cell.hyperlink).toBeUndefined();
      wb.eachSheet((sheet) =>
        sheet.eachRow((row) =>
          row.eachCell((c) => {
            expect(c.type).not.toBe(ExcelJS.ValueType.Formula);
            expect(c.formula).toBeUndefined();
          }),
        ),
      );
    }
  });
});
