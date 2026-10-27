import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, seedFullYear, confirmFixture, closePnl, balanceFacts } from './fixture';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import type { Configuration, Statement } from '../../templates/nonprofit/model';

let book: TestBook, c: Configuration;
beforeEach(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  c = await confirmFixture(book.svc, await seedFullYear(book.svc));
});
afterEach(async () => book?.close());
const amounts = (s: Statement) =>
  Object.fromEntries(s.rows.filter((r) => !r.section).map((r) => [r.id, r.values]));
// 全部金额格为独立手算常量，未调用被测公式或用余额表产生期望。
const balanceExpected: Record<string, number[]> = {
  cash: [300000, 326480],
  shortInvestment: [9900, 3900],
  receivables: [5950, 6020],
  prepayments: [4500, 4500],
  inventory: [4920, 4920],
  deferred: [600, 600],
  currentInvestment: [1990, 4980],
  otherCurrentAssets: [900, 900],
  currentAssetsTotal: [328760, 352300],
  equityInvestment: [6970, 6970],
  debtInvestment: [5980, 2990],
  otherInvestment: [8970, 8970],
  investmentTotal: [21920, 18930],
  fixedCost: [20000, 20000],
  depreciation: [1000, 1000],
  fixedNet: [18900, 18900],
  construction: [2000, 2000],
  disposal: [-200, -200],
  fixedTotal: [20700, 20700],
  culturalResources: [4000, 4000],
  intangibleCost: [6000, 6000],
  amortization: [300, 300],
  intangibleNet: [5650, 5650],
  longDeferred: [700, 700],
  noncurrentAssetsTotal: [52970, 49980],
  agencyAsset: [13000, 13000],
  assetsTotal: [394730, 415280],
  shortBorrowing: [10000, 10000],
  payables: [3500, 3500],
  employees: [300, 300],
  taxes: [400, 400],
  advances: [1000, 1000],
  accruals: [200, 200],
  currentDebt: [4000, 7000],
  otherCurrentLiabilities: [800, 800],
  currentLiabilitiesTotal: [20200, 23200],
  longBorrowing: [6000, 3000],
  longPayables: [2000, 2000],
  provisions: [500, 500],
  otherLongLiabilities: [600, 600],
  longLiabilitiesTotal: [9100, 6100],
  agencyLiability: [13000, 13000],
  liabilitiesTotal: [42300, 42300],
  unrestricted: [300000, 312410],
  restricted: [52430, 60570],
  netAssetsTotal: [352430, 372980],
  liabilitiesNetAssetsTotal: [394730, 415280],
};
const activityExpected: Record<string, number[]> = {
  donations: [7200, 4800, 12000, 7200, 4800, 12000],
  dues: [1440, 960, 2400, 1440, 960, 2400],
  services: [2160, 1440, 3600, 2160, 1440, 3600],
  grants: [2880, 1920, 4800, 2880, 1920, 4800],
  sales: [3600, 2400, 6000, 3600, 2400, 6000],
  headquarters: [4320, 2880, 7200, 4320, 2880, 7200],
  investmentIncome: [5040, 3360, 8400, 5040, 3360, 8400],
  otherIncome: [5760, 3840, 9600, 5760, 3840, 9600],
  incomeTotal: [32400, 21600, 54000, 32400, 21600, 54000],
  activityCost: [720, 480, 1200, 720, 480, 1200],
  'detail:合成教育活动': [720, 0, 720, 720, 0, 720],
  'detail:合成慈善信托': [0, 480, 480, 0, 480, 480],
  charitableTrust: [0, 480, 480, 0, 480, 480],
  taxExpense: [1440, 960, 2400, 1440, 960, 2400],
  administration: [2160, 1440, 3600, 2160, 1440, 3600],
  fundraising: [2880, 1920, 4800, 2880, 1920, 4800],
  fundraisingCost: [2880, 0, 2880, 2880, 0, 2880],
  impairment: [3600, 2400, 6000, 3600, 2400, 6000],
  incomeTax: [4320, 2880, 7200, 4320, 2880, 7200],
  otherExpense: [5040, 3360, 8400, 5040, 3360, 8400],
  expenseTotal: [20160, 13440, 33600, 20160, 13440, 33600],
  release: [50, -50, 0, 50, -50, 0],
  restriction: [-30, 30, 0, -30, 30, 0],
  priorAdjustment: [70, 0, 70, 70, 0, 70],
  netChange: [12330, 8140, 20470, 12330, 8140, 20470],
};
const cashExpected: Record<string, number> = {
  donations: 12000,
  dues: 2400,
  services: 3600,
  sales: 6000,
  grants: 4800,
  otherOperatingReceipts: 16880,
  operatingReceipts: 45680,
  donationsPaid: 0,
  employeesPaid: 0,
  goodsServicesPaid: 1200,
  taxesPaid: 9600,
  otherOperatingPayments: 16800,
  operatingPayments: 27600,
  operatingNet: 18080,
  investmentRecovered: 0,
  investmentIncome: 8400,
  assetDisposal: 0,
  otherInvestingReceipts: 0,
  investingReceipts: 8400,
  assetPurchase: 0,
  investmentPaid: 0,
  otherInvestingPayments: 0,
  investingPayments: 0,
  investingNet: 8400,
  borrowings: 0,
  otherFinancingReceipts: 0,
  financingReceipts: 0,
  principalPaid: 0,
  interestPaid: 0,
  otherFinancingPayments: 0,
  financingPayments: 0,
  financingNet: 0,
  fx: 0,
  cashNet: 26480,
};
describe('w_bb_proc 民非2026三表完整逐格手算', () => {
  it('401全部年初与期末金额格；备抵、对象借贷方向、两时点到期与受托不重计', async () => {
    const { statement } = await generateNonprofit(book.svc, annual, c);
    expect(amounts(statement)).toEqual(balanceExpected);
    expect(statement.checks.filter((x) => x.difference !== 0)).toEqual([]);
  });
  it('402八收入七费用、业务组成、其中项、互转与调整、净变动全部六栏', async () => {
    const { statement } = await generateNonprofit(book.svc, { ...annual, code: '402' }, c);
    expect(amounts(statement)).toEqual(activityExpected);
    expect(statement.checks.filter((x) => x.difference !== 0)).toEqual([]);
  });
  it('403完整年度所有本年金额格与2026不要求填列，不伪造上年零；现金首尾26480', async () => {
    const { statement } = await generateNonprofit(book.svc, { ...annual, code: '403' }, c);
    expect(
      Object.fromEntries(statement.rows.filter((r) => !r.section).map((r) => [r.id, r.values[0]])),
    ).toEqual(cashExpected);
    for (const row of statement.rows.filter((r) => !r.section))
      expect(row.values[1]).toBe('不要求填列（2026年首次执行）');
    expect(statement.cashOpening).toBe(300000);
    expect(statement.cashClosing).toBe(326480);
    expect(statement.checks.filter((x) => x.difference !== 0)).toEqual([]);
  });
  it('损益结转前后401/402金额逐格一致，未把结转当退款或净资产互转', async () => {
    const before = await generateNonprofit(book.svc, annual, c);
    await closePnl(book.svc);
    const after = await generateNonprofit(book.svc, annual, c);
    expect(amounts(after.statement)).toEqual(amounts(before.statement));
    expect(
      amounts((await generateNonprofit(book.svc, { ...annual, code: '402' }, c)).statement),
    ).toEqual(activityExpected);
  });
  it('季度本期取四至六月，累计一至六月，不标本月', async () => {
    const request = {
      ...annual,
      code: '402' as const,
      kind: 'quarter' as const,
      from: 202604,
      to: 202606,
    };
    const scoped = structuredClone(c);
    scoped.balanceFacts = balanceFacts(await readNonprofitSources(book.svc, request), scoped);
    const { statement } = await generateNonprofit(book.svc, request, scoped);
    expect(statement.columns[0]).toBe('本季度数·非限定性');
    expect(amounts(statement).donations).toEqual([1800, 1200, 3000, 3600, 2400, 6000]);
    expect(amounts(statement).priorAdjustment).toEqual([70, 0, 70, 70, 0, 70]);
  });
});
