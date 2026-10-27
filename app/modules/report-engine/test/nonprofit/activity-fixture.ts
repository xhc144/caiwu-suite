import type { AccountingTemplateInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import type { ActivityTotalsMapping } from '../../templates/nonprofit/activity-totals';
import { balanceFixtureChart } from './balance-fixture';
import { nonprofitTestServer, seedCashflowDimensions } from './fixture';

const extra: AccountingTemplateInput['accounts'] = [
  { code: '4301', name: '会费收入', category: 'revenue' },
  { code: '4302', name: '政府补助收入', category: 'revenue' },
  { code: '4303', name: '商品销售收入', category: 'revenue' },
  { code: '4304', name: '总部拨款收入', category: 'revenue' },
  { code: '4305', name: '投资收益', category: 'revenue' },
  { code: '4306', name: '其他收入', category: 'revenue' },
  { code: '5401', name: '税金及附加', category: 'expense' },
  { code: '5402', name: '资产减值损失', category: 'expense' },
  { code: '5403', name: '所得税费用', category: 'expense' },
  { code: '5404', name: '其他费用', category: 'expense' },
];
export const activityFixtureChart = {
  ...balanceFixtureChart,
  accounts: [...balanceFixtureChart.accounts, ...extra],
};
export const activityTestServer = { ...nonprofitTestServer, templates: [activityFixtureChart] };
export function activityFixtureMapping(period = 202602): ActivityTotalsMapping {
  const codes = {
    donations: '4101',
    dues: '4301',
    services: '4201',
    grants: '4302',
    sales: '4303',
    headquarters: '4304',
    investmentIncome: '4305',
    otherIncome: '4306',
    activityCost: '5101',
    taxExpense: '5401',
    administration: '5201',
    fundraising: '5301',
    impairment: '5402',
    incomeTax: '5403',
    otherExpense: '5404',
  };
  return {
    period,
    groups: Object.fromEntries(
      Object.entries(codes).map(([id, account]) => [
        id,
        { accounts: [account], basis: `虚构总账收入费用项目${id}的科目范围核对，不包含限定性认定` },
      ]),
    ) as ActivityTotalsMapping['groups'],
  };
}
export async function seedActivity402Book(svc: CoreServices) {
  await seedCashflowDimensions(svc);
  await seedVouchers(svc, [
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
    {
      date: '2026-02-03',
      status: 'posted',
      lines: [
        { account: '410101', debit: 2_000 },
        { account: '100201', credit: 2_000, dims: { cashflow: 'NF_donations' } },
      ],
    },
  ]);
  const custom = await svc.vouchers.create({
    ...(await voucherInputFromSpec(svc, {
      date: '2026-02-04',
      lines: [
        { account: '410101', debit: 1_000 },
        { account: '1122', credit: 1_000 },
      ],
    })),
    closingKind: 'period-close:custom01',
  });
  await svc.vouchers.changeStatus({ ids: [custom.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [custom.id], to: 'posted' });
}
export async function closeActivity402Pnl(svc: CoreServices) {
  const v = await svc.vouchers.create({
    ...(await voucherInputFromSpec(svc, {
      date: '2026-02-28',
      lines: [
        { account: '410101', debit: 57_000 },
        { account: '410102', debit: 40_000 },
        { account: '4201', debit: 20_000 },
        { account: '510101', credit: 12_000 },
        { account: '510102', credit: 5_000 },
        { account: '3101', credit: 65_000 },
        { account: '3102', credit: 35_000 },
      ],
    })),
    closingKind: 'pnl',
  });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
}
