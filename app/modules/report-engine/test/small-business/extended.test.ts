import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import { ReportTemplateSchema, type Report, type ReportSnapshot } from '../../shared';
import reportServer from '../../server';
import balanceJson from '../../templates/small-business/301.json';
import incomeMonthlyJson from '../../templates/small-business/302-monthly.json';
import incomeAnnualJson from '../../templates/small-business/302-annual.json';
import cashflowAnnualJson from '../../templates/small-business/303-annual.json';
import { balanceAddress, statementAddress } from '../../templates/small-business/catalogue';
import { cashflowGolden, smallBusinessApp } from './fixture';
import {
  incomeGolden,
  seedAnnualCashflowBook,
  seedExtendedIncomeBook,
  seedReclassificationBook,
  closeProfitAndLoss,
} from './extended-fixture';
import {
  extendedIncomeTemplate,
  type IncomeDetails,
} from '../../templates/small-business/extended';

let app: TestApp;
beforeEach(async () => {
  app = await smallBusinessApp(1, 2025);
});
afterEach(async () => {
  await app.close();
});
const api = () => app.call(reportServer);
async function generate(report: Report, period: number) {
  const result = await api().generate({
    id: report.id,
    expectedRevision: report.revision,
    period,
    requestId: randomUUID(),
  });
  if (result.kind !== 'generated') throw new Error('意外的未过账确认');
  return result.snapshot;
}
const value = (snapshot: ReportSnapshot, address: string) => {
  const c = snapshot.cells.find((c) => c.address === address);
  if (!c) throw new Error(`缺少${address}`);
  return c.value;
};
function incomeValues(
  snapshot: ReportSnapshot,
  key: 'ytd' | 'comparison',
  expected: Record<number, number>,
) {
  for (const [line, amount] of Object.entries(expected))
    expect(value(snapshot, statementAddress(Number(line), key))).toBe(String(amount));
}

it('w_bb_proc小企业302真实JSON：损益已结转仍正确取13个主项/合计；custom501分不得被excludePnl误排', async () => {
  await seedExtendedIncomeBook(app.svc);
  const r = await api().importTemplate(ReportTemplateSchema.parse(incomeMonthlyJson));
  const january = await generate(r, 202601);
  incomeValues(january, 'ytd', incomeGolden.january);
  incomeValues(january, 'comparison', incomeGolden.january);
  const february = await generate(r, 202602);
  incomeValues(february, 'ytd', incomeGolden.ytd);
  incomeValues(february, 'comparison', incomeGolden.february);
  expect(value(january, 'C19')).toBe('1501');
  expect(value(january, 'C37')).toBe('3297');
  expect(value(february, 'C9')).toBe('未实现：需真实明细科目映射');
  const exported = await api().exportResult({ id: r.id, period: 202602 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
  expect(wb.worksheets[0]!.getCell('C37').value).toBe(96.96);
  expect(wb.worksheets[0]!.getCell('D37').value).toBe(63.99);
  expect(wb.worksheets[0]!.getCell('C9').value).toContain('未实现');
});

it('w_bb_proc小企业302年报取上年全年，previousYearEnd不能误用上年同月；两年结转后仍为9696/14098分', async () => {
  await seedExtendedIncomeBook(app.svc);
  const r = await api().importTemplate(ReportTemplateSchema.parse(incomeAnnualJson));
  const annual = await generate(r, 202612);
  incomeValues(annual, 'ytd', incomeGolden.ytd);
  incomeValues(annual, 'comparison', incomeGolden.previousYear);
  // 去年只有12月有发生；二月生成的比较列也必须取完整上年，不能悄悄变成上年1—2月的零。
  const february = await generate(r, 202602);
  incomeValues(february, 'comparison', incomeGolden.previousYear);
  expect(await api().exportTemplate({ id: r.id })).toEqual(
    ReportTemplateSchema.parse(incomeAnnualJson),
  );
});

it('w_bb_proc小企业301：按末级及往来对象先分方向，正贷方1202分不再次取负；年初/期末分别取数', async () => {
  await app.close();
  app = await smallBusinessApp();
  await seedReclassificationBook(app.svc);
  const r = await api().importTemplate(ReportTemplateSchema.parse(balanceJson));
  const s = await generate(r, 202602);
  expect(value(s, balanceAddress(4, 'closing'))).toBe('1402');
  expect(value(s, balanceAddress(4, 'yearOpening'))).toBe('1803');
  expect(value(s, balanceAddress(33, 'closing'))).toBe('1202');
  expect(value(s, balanceAddress(33, 'yearOpening'))).toBe('1002');
  expect(value(s, balanceAddress(5, 'closing'))).toContain('未实现');
  expect(value(s, balanceAddress(34, 'closing'))).toContain('未实现');
});

it('w_bb_proc小企业303年报真实JSON：本年/上年22行逐格手算，期初274397/100000、期末466384/274397分', async () => {
  await seedAnnualCashflowBook(app.svc);
  const r = await api().importTemplate(ReportTemplateSchema.parse(cashflowAnnualJson));
  const s = await generate(r, 202612);
  for (let line = 1; line <= 20; line++) {
    expect(value(s, statementAddress(line, 'ytd'))).toBe(
      String(cashflowGolden.ytdFebruary[line - 1]),
    );
    expect(value(s, statementAddress(line, 'comparison'))).toBe(
      String(cashflowGolden.january[line - 1]),
    );
  }
  for (const [address, expected] of [
    ['C26', '274397'],
    ['D26', '100000'],
    ['C27', '466384'],
    ['D27', '274397'],
  ])
    expect(value(s, address!)).toBe(expected);
  expect(s.checks).toHaveLength(8);
  expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
  const exported = await api().exportResult({ id: r.id, period: 202612 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
  expect(wb.worksheets[0]!.getCell('C27').value).toBe(4663.84);
  expect(wb.worksheets[0]!.getCell('D27').value).toBe(2743.97);
  expect(wb.worksheets[0]!.getCell('D6').note).toContain('E31-F31');
});

it('w_bb_proc小企业302：首年缺上年期间、启用前累计无结转依据均明确失败，不产生零比较数', async () => {
  await app.close();
  app = await smallBusinessApp();
  const r = await api().importTemplate(ReportTemplateSchema.parse(incomeAnnualJson));
  await expect(generate(r, 202612)).rejects.toThrow(/早于|还没有建立|启用/);
  expect(await api().snapshot({ id: r.id, period: 202612 })).toBeNull();
  await app.close();
  app = await smallBusinessApp(3);
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('5001')).id,
    balance: -700,
    ytdCredit: 700,
  });
  const monthly = await api().importTemplate(ReportTemplateSchema.parse(incomeMonthlyJson));
  await expect(generate(monthly, 202603)).rejects.toThrow(/早于|启用前/);
  expect(await api().snapshot({ id: monthly.id, period: 202603 })).toBeNull();
});

it('w_bb_proc小企业302：显式真实明细映射后32行全部取数，原文合计和包含关系真实审核', async () => {
  await app.svc.periods.ensureYear(2026);
  const mapping: IncomeDetails = {
    4: ['540301'],
    5: ['540302'],
    6: ['540303'],
    7: ['540304'],
    8: ['540305'],
    9: ['540306'],
    10: ['540307'],
    12: ['560101'],
    13: ['560102'],
    15: ['560201'],
    16: ['560202'],
    17: ['560203'],
    19: ['560301'],
    23: ['530101'],
    25: ['571101'],
    26: ['571102'],
    27: ['571103'],
    28: ['571104'],
    29: ['571105'],
  };
  for (const [line, codes] of Object.entries(mapping))
    for (const code of codes)
      await app.svc.accounts.create({ code, name: `明细${line}` }, [4, 2, 2]);
  const details = [
    ['540301', 1],
    ['540302', 2],
    ['540303', 3],
    ['540304', 4],
    ['540305', 5],
    ['540306', 6],
    ['540307', 7],
    ['560101', 1101],
    ['560102', 1301],
    ['560201', 1501],
    ['560202', 1601],
    ['560203', 1701],
    ['560301', 1901],
    ['571101', 2501],
    ['571102', 2601],
    ['571103', 2701],
    ['571104', 2801],
    ['571105', 2901],
    ['5401', 20001],
    ['5801', 1001],
  ] as const;
  await seedVouchers(
    app.svc,
    details.map(([account, amount]) => ({
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account, debit: amount },
        { account: '1001', credit: amount },
      ],
    })),
  );
  await seedVouchers(
    app.svc,
    [
      ['5001', 50001],
      ['5111', 2001],
      ['530101', 2301],
      ['560301', 201],
    ].map(([code, amount]) => ({
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: String(code), credit: Number(amount) },
        { account: '1001', debit: Number(amount) },
      ],
    })),
  );
  await closeProfitAndLoss(app.svc, 2026, 1);
  const r = await api().importTemplate(extendedIncomeTemplate('monthly', mapping));
  const s = await generate(r, 202601);
  const golden = [
    50001, 20001, 28, 1, 2, 3, 4, 5, 6, 7, 2402, 1101, 1301, 4803, 1501, 1601, 1701, 1700, 1700,
    2001, 23068, 2301, 2301, 13505, 2501, 2601, 2701, 2801, 2901, 11864, 1001, 10863,
  ];
  for (let line = 1; line <= golden.length; line++)
    for (const key of ['ytd', 'comparison'] as const)
      expect(value(s, statementAddress(line, key))).toBe(String(golden[line - 1]));
  expect(s.checks).toHaveLength(18);
  expect(s.checks.every((check) => check.status === 'pass')).toBe(true);
  expect(() => extendedIncomeTemplate('monthly', { 4: ['540301'], 5: ['540301'] })).toThrow(/重复/);
  expect(() => extendedIncomeTemplate('monthly', { 4: ['500101'] })).toThrow(/不正确/);
});
