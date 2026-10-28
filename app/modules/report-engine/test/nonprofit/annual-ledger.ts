import { seedVouchers, voucherInputFromSpec, type LineSpec } from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import { periodEndDate } from '@caiwu/core';
import {
  balanceKey,
  mappedRow,
  type Configuration,
  type Sources,
  type StatementRequest,
} from '../../templates/nonprofit/model';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import { annual, confirmFixture, seedFullYear, seedBusinessYear } from './fixture';

export const factors2026 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const factors2027 = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
type CashAllocation = Configuration['cashConfirmations'][number]['allocations'][number];

/** 合成凭据按签发时记录现金用途，不从生成报表或余额表反推分类。金额单位均为分。 */
async function seedExtraBusiness(svc: CoreServices, year: number, factors: readonly number[]) {
  const cash = new Map<number, CashAllocation[]>();
  for (const [i, factor] of factors.entries()) {
    const post = async (
      lines: LineSpec[],
      row?: CashAllocation['row'],
      amount = 0,
      nature: CashAllocation['nature'] = 'ordinary',
    ) => {
      const [v] = await seedVouchers(svc, [
        { date: `${year}-${String(i + 1).padStart(2, '0')}-15`, status: 'posted', lines },
      ]);
      if (row)
        for (const l of v!.lines.filter((l) => ['1001', '1002'].includes(l.accountCode)))
          cash.set(l.id, [
            {
              row,
              amount: row === 'internal' ? l.debit - l.credit : amount * factor,
              nature,
              sourceReference: `合成${year}年${i + 1}月${row}原始单据`,
              ...(row === 'internal' ? { transferReference: `合成内部划转${v!.id}` } : {}),
            },
          ]);
    };
    for (const [row, account, amount] of [
      ['investmentRecovered', '1101', 15],
      ['assetDisposal', '1509', 20],
      ['otherInvestingReceipts', '1122', 25],
      ['borrowings', '2101', 30],
      ['otherFinancingReceipts', '2502', 35],
      ['fx', '5401', 80],
    ] as const)
      await post(
        [
          { account: '1002', debit: amount * factor },
          { account, credit: amount * factor },
        ],
        row,
        amount,
      );
    for (const [row, account, amount, nature] of [
      ['donationsPaid', '5101', 40, 'ordinary'],
      ['employeesPaid', '2204', 45, 'ordinary'],
      ['assetPurchase', '1505', 50, 'engineeringPayroll'],
      ['investmentPaid', '1101', 55, 'ordinary'],
      ['otherInvestingPayments', '1122', 60, 'ordinary'],
      ['principalPaid', '2101', 65, 'ordinary'],
      ['interestPaid', '1505', 70, 'capitalizedInterest'],
      ['otherFinancingPayments', '2502', 75, 'financeLease'],
      ['donations', '4101', 10, 'ordinary'],
      ['assetDisposal', '1509', 15, 'disposal'],
    ] as const)
      await post(
        [
          { account, debit: amount * factor },
          { account: '1002', credit: amount * factor },
        ],
        row,
        -amount,
        nature,
      );
    await post(
      [
        { account: '1001', debit: 85 * factor },
        { account: '1002', credit: 85 * factor },
      ],
      'internal',
    );
    await post([
      { account: '1009', debit: 90 * factor },
      { account: '2601', credit: 90 * factor },
    ]);
    await post([
      { account: '1501', debit: 95 * factor },
      { account: '220201', credit: 95 * factor },
    ]);
    await post([
      { account: '5301', debit: 120 * factor },
      { account: '1502', credit: 100 * factor },
      { account: '1602', credit: 20 * factor },
    ]);
  }
  return cash;
}

/** 合同在两个年度保持不变，按每一真实报表时点重新判断一年内到期。 */
export function confirmAnnualBalances(s: Sources, c: Configuration) {
  const facts: Configuration['balanceFacts'] = [];
  for (const point of ['opening', 'closing'] as const) {
    const at = point === 'opening' ? s.openingDate : s.closingDate;
    const year = Number(at.slice(0, 4));
    const limit = `${year + 1}${at.slice(4)}`;
    const investment = (due: string) => (due <= limit ? 'currentInvestment' : 'debtInvestment');
    const borrowing = (due: string) => (due <= limit ? 'currentDebt' : 'longBorrowing');
    for (const b of s.balances) {
      const row = mappedRow(b.accountCode, c.mappings),
        n = b[point];
      if (!n) continue;
      const part = (row: string, amount: number, maturity?: string, agency = false) => ({
        row,
        amount,
        maturity,
        agency,
        sourceReference: '合成实际资产合同及受托协议',
      });
      let allocations: Configuration['balanceFacts'][number]['allocations'] = [];
      if (row === 'debtInvestment')
        allocations = [
          part(investment('2026-06-01'), 2000, '2026-06-01'),
          part(investment('2027-06-01'), 3000, '2027-06-01'),
          part(investment('2028-06-01'), 3000, '2028-06-01'),
        ];
      if (row === 'investmentAllowance')
        allocations = [
          part('equityInvestment', -30),
          part(investment('2026-06-01'), -10, '2026-06-01'),
          part(investment('2027-06-01'), -10, '2027-06-01'),
          part(investment('2028-06-01'), -10, '2028-06-01'),
          part('otherInvestment', -30, '2029-06-01'),
        ];
      if (row === 'longBorrowing')
        allocations = [
          part(borrowing('2026-06-01'), -4000, '2026-06-01'),
          part(borrowing('2027-06-01'), -3000, '2027-06-01'),
          part(borrowing('2028-06-01'), -3000, '2028-06-01'),
        ];
      if (['otherInvestment', 'longPayables', 'otherLongLiabilities'].includes(row ?? ''))
        allocations = [part(row!, n, '2029-06-01')];
      if (row === 'fixedAllowance') allocations = [part('fixedNet', n)];
      if (row === 'intangibleAllowance') allocations = [part('intangibleNet', n)];
      if (row === 'cash')
        allocations = [
          part(
            b.accountCode === '1009' ? 'agencyAsset' : 'cash',
            n,
            undefined,
            b.accountCode === '1009',
          ),
        ];
      if (allocations.length) facts.push({ at, key: balanceKey(b), balance: n, allocations });
    }
  }
  return facts;
}

export async function configurationAt(
  svc: CoreServices,
  c: Configuration,
  request: StatementRequest,
) {
  const result = structuredClone(c);
  result.balanceFacts = confirmAnnualBalances(await readNonprofitSources(svc, request), result);
  return result;
}

export async function seedAnnualLedger(svc: CoreServices, year: number) {
  const factors = year === 2026 ? factors2026 : factors2027;
  const events = year === 2026 ? await seedFullYear(svc, year, factors) : undefined;
  if (!events) await seedBusinessYear(svc, year, factors);
  if (year === 2026) {
    await svc.opening.upsert({
      year,
      accountId: (await svc.accounts.require('1101')).id,
      balance: 200000,
    });
    await svc.opening.upsert({
      year,
      accountId: (await svc.accounts.require('3101')).id,
      balance: -490000,
    });
  }
  const cash = await seedExtraBusiness(svc, year, factors);
  // confirmFixture 只关联真实分录及外部资源，不生成任何报表期望金额。
  const c = await confirmFixture(svc, events, year);
  if (year === 2026) c.resources[0]!.openingBalance = 490000;
  else {
    c.resources[0]!.openingBalance = 565518;
    c.resources[1]!.openingBalance = 102642;
    c.comparison = { basis: '合成两个年度使用相同2026制度及资源分类', restatements: [] };
  }
  const s = await readNonprofitSources(svc, {
    ...annual,
    from: year * 100 + 1,
    to: year * 100 + 12,
  });
  for (const confirmation of c.cashConfirmations) {
    const planned = cash.get(confirmation.line.lineId);
    if (planned) confirmation.allocations = planned;
  }
  c.balanceFacts = confirmAnnualBalances(s, c);
  return c;
}

/** 每月分别关闭15个损益科目；净额1610中非限定966、限定644，由原始业务手算。 */
export async function closeAnnualLedgerMonth(svc: CoreServices, year: number, month: number) {
  const factor = (year === 2026 ? factors2026 : factors2027)[month - 1]!;
  const input = await voucherInputFromSpec(svc, {
    date: periodEndDate(year * 100 + month),
    lines: [
      ...[
        ['4101', 990],
        ['4201', 200],
        ['4301', 300],
        ['4401', 400],
        ['4501', 500],
        ['4701', 600],
        ['4601', 700],
        ['4901', 800],
      ].map(([account, n]) => ({ account: String(account), debit: Number(n) * factor })),
      ...[
        ['5101', 140],
        ['5201', 200],
        ['5301', 420],
        ['5401', 320],
        ['5501', 500],
        ['5601', 600],
        ['5901', 700],
      ].map(([account, n]) => ({ account: String(account), credit: Number(n) * factor })),
      { account: '3101', credit: 966 * factor },
      { account: '3102', credit: 644 * factor },
    ],
  });
  const v = await svc.vouchers.create({ ...input, closingKind: 'pnl' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
}
