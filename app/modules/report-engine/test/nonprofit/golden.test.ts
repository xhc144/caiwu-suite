import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sumCents, type BalanceRow } from '@caiwu/core';
import {
  createTestApp,
  seedVouchers,
  voucherInputFromSpec,
  type TestApp,
  type VoucherSpec,
} from '@caiwu/testkit';
import { fixtureChart, nonprofitTestServer, seedCashflowDimensions } from './fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [nonprofitTestServer],
    product: 'minfei',
    templateId: fixtureChart.id,
    seed: false,
  });
});
afterEach(async () => {
  await app?.close();
});

/** 这些是供共享取数接入时复用的独立黄金账套；没有声称401/402已经能由引擎生成。 */
describe('401/402独立手算黄金账套（尚未接入报表引擎）', () => {
  it('401：衔接后新账年初249000分；受托现金重列、减值净额、一年内到期重分类不重计', async () => {
    const opening = {
      '1001': 10_000,
      '100201': 50_000,
      '100202': 7_000,
      '1101': 20_000,
      '1102': -2_000,
      '1122': 30_000,
      '1131': -3_000,
      '1401': 15_000,
      '1402': -1_000,
      '150101': 12_000,
      '150102': 28_000,
      '150201': -1_000,
      '150202': -2_000,
      '1601': 80_000,
      '1602': -16_000,
      '1603': -4_000,
      '1701': 9_000,
      '1801': 20_000,
      '1802': -5_000,
      '1803': -1_000,
      '1901': 3_000,
      '2001': -25_000,
      '2101': -10_000,
      '230101': -10_000,
      '230102': -20_000,
      '3101': -144_000,
      '3102': -40_000,
    };
    for (const [code, balance] of Object.entries(opening))
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require(code)).id,
        balance,
      });
    const trial = await app.svc.ledger.trialBalance(202601, 202601);
    expect(trial.balanced).toBe(true);
    const rows = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      rollup: true,
      includeZero: true,
    });
    const b = (code: string) => rows.find((r) => r.accountCode === code)!.opening;
    // 借正贷负；准备科目直接与资产有符号余额相加，贷方负债/净资产转为列报正数。
    const actual = {
      cash: sumCents([b('1001'), b('1002'), -b('100202')]),
      shortInvestment: sumCents([b('1101'), b('1102')]),
      receivables: sumCents([b('1122'), b('1131')]),
      inventory: sumCents([b('1401'), b('1402')]),
      currentInvestment: sumCents([b('150101'), b('150201')]),
      longDebtInvestment: sumCents([b('150102'), b('150202')]),
      fixedNet: sumCents([b('1601'), b('1602'), b('1603')]),
      culturalResources: b('1701'),
      intangibleNet: sumCents([b('1801'), b('1802'), b('1803')]),
      agencyAsset: sumCents([b('1901'), b('100202')]),
      shortBorrowing: -b('2001'),
      currentDebt: -b('230101'),
      longDebt: -b('230102'),
      agencyLiability: -b('2101'),
      unrestricted: -b('3101'),
      restricted: -b('3102'),
    };
    expect(actual).toEqual({
      cash: 60_000,
      shortInvestment: 18_000,
      receivables: 27_000,
      inventory: 14_000,
      currentInvestment: 11_000,
      longDebtInvestment: 26_000,
      fixedNet: 60_000,
      culturalResources: 9_000,
      intangibleNet: 14_000,
      agencyAsset: 10_000,
      shortBorrowing: 25_000,
      currentDebt: 10_000,
      longDebt: 20_000,
      agencyLiability: 10_000,
      unrestricted: 144_000,
      restricted: 40_000,
    });
    expect(
      sumCents([
        actual.cash,
        actual.shortInvestment,
        actual.receivables,
        actual.inventory,
        actual.currentInvestment,
      ]),
    ).toBe(130_000);
    expect(
      sumCents([
        actual.longDebtInvestment,
        actual.fixedNet,
        actual.culturalResources,
        actual.intangibleNet,
      ]),
    ).toBe(109_000);
    expect(sumCents([130_000, 109_000, actual.agencyAsset])).toBe(249_000);
    expect(
      sumCents([
        actual.shortBorrowing,
        actual.currentDebt,
        actual.longDebt,
        actual.agencyLiability,
        actual.unrestricted,
        actual.restricted,
      ]),
    ).toBe(249_000);

    // 2月发生额改变月初而不改变年初。不能将BALANCE(opening)误作全年年初数。
    await seedCashflowDimensions(app.svc);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-15',
        status: 'posted',
        lines: [
          { account: '100201', debit: 10_000, dims: { cashflow: 'NF_donations' } },
          { account: '410102', credit: 10_000 },
        ],
      },
    ]);
    const feb = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      accountCodes: ['100201'],
      rollup: false,
    });
    expect(feb[0]!.opening).toBe(60_000);
    expect(
      (await app.svc.opening.list(2026)).find((r) => r.accountId === feb[0]!.accountId)!.balance,
    ).toBe(50_000);
  });

  it('402：限定来源是捐赠约定对应明细科目；本月/累计、双向转限制、以前年度调整及结转前后均需区分', async () => {
    await seedCashflowDimensions(app.svc);
    const specs: VoucherSpec[] = [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '100201', debit: 100_000, dims: { cashflow: 'NF_donations' } },
          { account: '410101', credit: 60_000 },
          { account: '410102', credit: 40_000 },
        ],
      },
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '510101', debit: 10_000 },
          { account: '510102', debit: 5_000 },
          { account: '100201', credit: 15_000, dims: { cashflow: 'NF_goodsServicesPaid' } },
        ],
      },
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '100201', debit: 20_000, dims: { cashflow: 'NF_services' } },
          { account: '4201', credit: 20_000 },
        ],
      },
      {
        date: '2026-02-02',
        status: 'posted',
        lines: [
          { account: '510101', debit: 2_000 },
          { account: '100201', credit: 2_000, dims: { cashflow: 'NF_goodsServicesPaid' } },
        ],
      },
      // 解除限制审批R-01：限定借6000，非限定贷6000；指定用途审批R-02为反向2000。
      {
        date: '2026-02-03',
        status: 'posted',
        summary: '解除限制审批R-01',
        lines: [
          { account: '3102', debit: 6_000 },
          { account: '3101', credit: 6_000 },
        ],
      },
      {
        date: '2026-02-04',
        status: 'posted',
        summary: '新设限制审批R-02',
        lines: [
          { account: '3101', debit: 2_000 },
          { account: '3102', credit: 2_000 },
        ],
      },
      // 以前年度非限定净资产调减1000：调整科目借记，完成报表计算后另行结转。
      {
        date: '2026-02-05',
        status: 'posted',
        summary: '以前年度费用漏记更正凭据A-01',
        lines: [
          { account: '5901', debit: 1_000 },
          { account: '1122', credit: 1_000 },
        ],
      },
    ];
    const vouchers = await seedVouchers(app.svc, specs);
    const rows = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      rollup: false,
    });
    const find = (code: string): BalanceRow => rows.find((r) => r.accountCode === code)!;
    expect(find('410101')).toMatchObject({ credit: 0, ytdCredit: 60_000 });
    expect(find('410102')).toMatchObject({ credit: 0, ytdCredit: 40_000 });
    expect(find('4201')).toMatchObject({ credit: 20_000, ytdCredit: 20_000 });
    expect(find('510101')).toMatchObject({ debit: 2_000, ytdDebit: 12_000 });
    expect(find('510102')).toMatchObject({ debit: 0, ytdDebit: 5_000 });
    const release = vouchers[4]!.lines.find((l) => l.accountCode === '3101')!.credit;
    const restrict = vouchers[5]!.lines.find((l) => l.accountCode === '3101')!.debit;
    expect([release, restrict]).toEqual([6_000, 2_000]);
    expect(find('5901').debit).toBe(1_000);
    // 独立手算固定答案；列顺序为非限定、限定、合计。互转在合计列为0，调减为负数。
    const golden = {
      monthIncome: [20_000, 0, 20_000],
      ytdIncome: [80_000, 40_000, 120_000],
      monthExpense: [2_000, 0, 2_000],
      ytdExpense: [12_000, 5_000, 17_000],
      release: [6_000, -6_000, 0],
      restriction: [-2_000, 2_000, 0],
      adjustment: [-1_000, 0, -1_000],
      monthNet: [21_000, -4_000, 17_000],
      ytdNet: [71_000, 31_000, 102_000],
    };
    expect(
      sumCents([
        find('4201').credit,
        -find('510101').debit,
        release,
        -restrict,
        -find('5901').debit,
      ]),
    ).toBe(golden.monthNet[0]);
    expect(
      sumCents([
        find('410101').ytdCredit,
        find('4201').ytdCredit,
        -find('510101').ytdDebit,
        release,
        -restrict,
        -find('5901').debit,
      ]),
    ).toBe(golden.ytdNet[0]);
    expect(sumCents([find('410102').ytdCredit, -find('510102').ytdDebit, -release, restrict])).toBe(
      golden.ytdNet[1],
    );

    const closing = await app.svc.vouchers.create({
      ...(await voucherInputFromSpec(app.svc, {
        date: '2026-02-28',
        lines: [
          { account: '410101', debit: 60_000 },
          { account: '410102', debit: 40_000 },
          { account: '4201', debit: 20_000 },
          { account: '510101', credit: 12_000 },
          { account: '510102', credit: 5_000 },
          { account: '3101', credit: 68_000 },
          { account: '3102', credit: 35_000 },
        ],
      })),
      closingKind: 'pnl',
    });
    await app.svc.vouchers.changeStatus({ ids: [closing.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [closing.id], to: 'posted' });
    const after = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      rollup: false,
    });
    expect(after.find((r) => r.accountCode === '410101')).toMatchObject({
      closing: 0,
      debit: 60_000,
      credit: 0,
      ytdDebit: 60_000,
      ytdCredit: 60_000,
    });
    // 此时直接贷减借累计会错成0；真实原始业务仍是非限定捐赠60000。
    const entries = await app.svc.ledger.entries({
      periodFrom: 202601,
      periodTo: 202602,
      accountCode: '410101',
    });
    const business = [];
    for (const e of entries)
      if ((await app.svc.vouchers.get(e.voucherId))!.closingKind !== 'pnl') business.push(e);
    expect(sumCents(business.map((e) => e.credit))).toBe(60_000);
  });
});
