import { afterEach, expect, it } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual } from './fixture';
import { seedAnnualLedger, configurationAt, closeAnnualLedgerMonth } from './annual-ledger';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import type { Configuration, Statement, StatementRequest } from '../../templates/nonprofit/model';

let book: TestBook;
afterEach(async () => book?.close());
const amounts = (s: Statement) =>
  Object.fromEntries(s.rows.filter((r) => !r.section).map((r) => [r.id, r.values]));

// 独立纸笔底稿：2026每月倍数1..12，2027为2..13；累计不是从总账/被测函数计算。
const cumulative = {
  2026: [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78],
  2027: [2, 5, 9, 14, 20, 27, 35, 44, 54, 65, 77, 90],
};
// 每份业务：收入4490，费用2880，净变动1610；60%非限定，40%限定。
const activityUnit: Record<string, [number, number, number]> = {
  donations: [594, 396, 990],
  dues: [120, 80, 200],
  services: [180, 120, 300],
  grants: [240, 160, 400],
  sales: [300, 200, 500],
  headquarters: [360, 240, 600],
  investmentIncome: [420, 280, 700],
  otherIncome: [480, 320, 800],
  incomeTotal: [2694, 1796, 4490],
  activityCost: [84, 56, 140],
  'detail:合成教育活动': [84, 0, 84],
  'detail:合成慈善信托': [0, 56, 56],
  charitableTrust: [0, 56, 56],
  taxExpense: [120, 80, 200],
  administration: [252, 168, 420],
  fundraising: [192, 128, 320],
  fundraisingCost: [192, 0, 192],
  impairment: [300, 200, 500],
  incomeTax: [360, 240, 600],
  otherExpense: [420, 280, 700],
  expenseTotal: [1728, 1152, 2880],
  netChange: [966, 644, 1610],
};
function activityExpected(year: 2026 | 2027, month: number, annualReport = false) {
  const factor = annualReport ? cumulative[year][11]! : month + (year === 2027 ? 1 : 0);
  const ytd = cumulative[year][month - 1]!;
  const result: Record<string, number[]> = Object.fromEntries(
    Object.entries(activityUnit).map(([id, values]) => [
      id,
      [...values.map((n) => n * factor), ...values.map((n) => n * ytd)],
    ]),
  );
  for (const [row, at, u, r] of [
    ['release', 2, 50, -50],
    ['restriction', 3, -30, 30],
    ['priorAdjustment', 4, 70, 0],
  ] as const) {
    const current = year === 2026 && (annualReport || month === at) ? [u, r, u + r] : [0, 0, 0];
    const total = year === 2026 && month >= at ? [u, r, u + r] : [0, 0, 0];
    result[row] = [...current, ...total];
    result.netChange = result.netChange!.map((n, i) => n + result[row]![i]!);
  }
  return result;
}

// 年初和每份业务的净变动均由借贷分录手算；小计系数也独立列出，不调用报表求和逻辑。
// 现金1920 = 经营1405 + 投资580 - 筹资145 + 汇兑80。
// 资产1675 = 现金1920 - 短投460 + 应收35 + 固定资产110 - 无形20 + 受托90。
// 负债65 = 应付95 - 员工45 - 短借35 - 长应付40 + 受托90。
const balanceUnits: Record<string, [number, number, number]> = {
  cash: [300000, 449840, 1920],
  shortInvestment: [199900, 164020, -460],
  receivables: [5950, 8750, 35],
  prepayments: [4500, 4500, 0],
  inventory: [4920, 4920, 0],
  deferred: [600, 600, 0],
  currentInvestment: [1990, 4980, 0],
  otherCurrentAssets: [900, 900, 0],
  currentAssetsTotal: [518760, 638510, 1495],
  equityInvestment: [6970, 6970, 0],
  debtInvestment: [5980, 2990, 0],
  otherInvestment: [8970, 8970, 0],
  investmentTotal: [21920, 18930, 0],
  fixedCost: [20000, 27410, 95],
  depreciation: [1000, 8800, 100],
  fixedNet: [18900, 18510, -5],
  construction: [2000, 11360, 120],
  disposal: [-200, -590, -5],
  fixedTotal: [20700, 29280, 110],
  culturalResources: [4000, 4000, 0],
  intangibleCost: [6000, 6000, 0],
  amortization: [300, 1860, 20],
  intangibleNet: [5650, 4090, -20],
  longDeferred: [700, 700, 0],
  noncurrentAssetsTotal: [52970, 57000, 90],
  agencyAsset: [13000, 20020, 90],
  assetsTotal: [584730, 715530, 1675],
  shortBorrowing: [10000, 7270, -35],
  payables: [3500, 10910, 95],
  employees: [300, -3210, -45],
  taxes: [400, 400, 0],
  advances: [1000, 1000, 0],
  accruals: [200, 200, 0],
  currentDebt: [4000, 7000, 0],
  otherCurrentLiabilities: [800, 800, 0],
  currentLiabilitiesTotal: [20200, 24370, 15],
  longBorrowing: [6000, 3000, 0],
  longPayables: [2000, -1120, -40],
  provisions: [500, 500, 0],
  otherLongLiabilities: [600, 600, 0],
  longLiabilitiesTotal: [9100, 2980, -40],
  agencyLiability: [13000, 20020, 90],
  liabilitiesTotal: [42300, 47370, 65],
  unrestricted: [490000, 565518, 966],
  restricted: [52430, 102642, 644],
  netAssetsTotal: [542430, 668160, 1610],
  liabilitiesNetAssetsTotal: [584730, 715530, 1675],
};
function balanceExpected(year: 2026 | 2027, month: number) {
  const openingIndex = year === 2026 ? 0 : 1;
  const units = cumulative[year][month - 1]!;
  const result: Record<string, number[]> = Object.fromEntries(
    Object.entries(balanceUnits).map(([id, values]) => [
      id,
      [values[openingIndex], values[openingIndex] + units * values[2]],
    ]),
  );
  const change = (row: string, n: number) => (result[row]![1]! += n);
  if (month >= 6) {
    for (const row of ['currentInvestment', 'currentAssetsTotal']) change(row, 2990);
    for (const row of ['debtInvestment', 'investmentTotal', 'noncurrentAssetsTotal'])
      change(row, -2990);
    for (const row of ['currentDebt', 'currentLiabilitiesTotal']) change(row, 3000);
    for (const row of ['longBorrowing', 'longLiabilitiesTotal']) change(row, -3000);
  }
  if (year === 2026) {
    const u =
      (month >= 2 ? 50 : 0) - (month >= 3 ? 30 : 0) + (month >= 4 ? 70 : 0) + (month >= 5 ? 80 : 0);
    const r = -(month >= 2 ? 50 : 0) + (month >= 3 ? 30 : 0);
    change('unrestricted', u);
    change('restricted', r);
    change('netAssetsTotal', u + r);
    change('receivables', month >= 4 ? 70 : 0);
    change('cash', month >= 5 ? 80 : 0);
    const direct = (month >= 4 ? 70 : 0) + (month >= 5 ? 80 : 0);
    for (const row of ['currentAssetsTotal', 'assetsTotal', 'liabilitiesNetAssetsTotal'])
      change(row, direct);
  }
  return result;
}

// 全部现金流行：2026合计78份业务，2027合计90份；2026五月另收到注册资金80。
const cashExpected: Record<string, [number, number]> = {
  donations: [77220, 89100],
  dues: [15600, 18000],
  services: [23400, 27000],
  sales: [39000, 45000],
  grants: [31200, 36000],
  otherOperatingReceipts: [109280, 126000],
  operatingReceipts: [295700, 341100],
  donationsPaid: [3120, 3600],
  employeesPaid: [3510, 4050],
  goodsServicesPaid: [7800, 9000],
  taxesPaid: [62400, 72000],
  otherOperatingPayments: [109200, 126000],
  operatingPayments: [186030, 214650],
  operatingNet: [109670, 126450],
  investmentRecovered: [1170, 1350],
  investmentIncome: [54600, 63000],
  assetDisposal: [390, 450],
  otherInvestingReceipts: [1950, 2250],
  investingReceipts: [58110, 67050],
  assetPurchase: [3900, 4500],
  investmentPaid: [4290, 4950],
  otherInvestingPayments: [4680, 5400],
  investingPayments: [12870, 14850],
  investingNet: [45240, 52200],
  borrowings: [2340, 2700],
  otherFinancingReceipts: [2730, 3150],
  financingReceipts: [5070, 5850],
  principalPaid: [5070, 5850],
  interestPaid: [5460, 6300],
  otherFinancingPayments: [5850, 6750],
  financingPayments: [16380, 18900],
  financingNet: [-11310, -13050],
  fx: [6240, 7200],
  cashNet: [149840, 172800],
};
async function monthlyChecks(year: 2026 | 2027, c: Configuration, previous?: Configuration) {
  for (let month = 1; month <= 12; month++) {
    const request: StatementRequest = {
      ...annual,
      kind: 'month',
      from: year * 100 + month,
      to: year * 100 + month,
    };
    const scoped = await configurationAt(book.svc, c, request);
    const prior = previous
      ? await configurationAt(book.svc, previous, {
          ...request,
          from: request.from - 100,
          to: request.to - 100,
        })
      : undefined;
    const expectedActivity = activityExpected(year, month);
    if (prior) {
      const old = activityExpected(2026, month);
      for (const [id, values] of Object.entries(expectedActivity))
        values.push(old[id]![2]!, old[id]![5]!);
    }
    const before = [];
    for (const code of ['401', '402'] as const) {
      const { statement } = await generateNonprofit(book.svc, { ...request, code }, scoped, prior);
      expect(amounts(statement), `${year}-${month} ${code}结转前逐行`).toEqual(
        code === '401' ? balanceExpected(year, month) : expectedActivity,
      );
      expect(statement.checks.every((x) => x.difference === 0)).toBe(true);
      before.push(statement);
    }
    await closeAnnualLedgerMonth(book.svc, year, month);
    for (const [i, code] of (['401', '402'] as const).entries()) {
      const { statement } = await generateNonprofit(book.svc, { ...request, code }, scoped, prior);
      expect(amounts(statement), `${year}-${month} ${code}结转后逐行`).toEqual(amounts(before[i]!));
      expect(statement.checks.every((x) => x.difference === 0)).toBe(true);
    }
  }
}
async function annualChecks(year: 2026 | 2027, c: Configuration, previous?: Configuration) {
  const request = { ...annual, from: year * 100 + 1, to: year * 100 + 12 };
  const scoped = await configurationAt(book.svc, c, request);
  const expected = activityExpected(year, 12, true);
  if (previous) {
    const old = activityExpected(2026, 12, true);
    for (const [id, values] of Object.entries(expected)) values.push(old[id]![2]!, old[id]![5]!);
  }
  expect(
    amounts(
      (await generateNonprofit(book.svc, { ...request, code: '402' }, scoped, previous)).statement,
    ),
  ).toEqual(expected);
  const { statement } = await generateNonprofit(
    book.svc,
    { ...request, code: '403' },
    scoped,
    previous,
  );
  expect(amounts(statement)).toEqual(
    Object.fromEntries(
      Object.entries(cashExpected).map(([id, values]) => [
        id,
        year === 2026 ? [values[0], '不要求填列（2026年首次执行）'] : [values[1], values[0]],
      ]),
    ),
  );
  expect(statement.cashOpening).toBe(year === 2026 ? 300000 : 449840);
  expect(statement.cashClosing).toBe(year === 2026 ? 449840 : 622640);
  expect(statement.checks.every((x) => x.difference === 0)).toBe(true);
}

it('w_bb_proc 2026固定账套十二个月：401全部两栏、402全部六栏，逐月结转前后及403每行手算', async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  const c = await seedAnnualLedger(book.svc, 2026);
  await monthlyChecks(2026, c);
  await annualChecks(2026, c);
}, 60000);

it('w_bb_proc 2027固定账套十二个月：全部本期/累计/上年可比行及年度现金比较，年初逐明细承接', async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  const previous = await seedAnnualLedger(book.svc, 2026);
  for (let month = 1; month <= 12; month++) await closeAnnualLedgerMonth(book.svc, 2026, month);
  const balances = await book.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202612,
    rollup: false,
    includeZero: true,
    groupBy: ['partner', 'person'],
  });
  await book.svc.periods.ensureYear(2027, { openingStored: true });
  await book.svc.opening.replaceYear(
    2027,
    balances
      .filter((b) => b.isLeaf && b.closing !== 0)
      .map((b) => ({ accountId: b.accountId, dimensions: b.dimensions, balance: b.closing })),
  );
  const c = await seedAnnualLedger(book.svc, 2027);
  await monthlyChecks(2027, c, previous);
  await annualChecks(2027, c, previous);
}, 60000);
