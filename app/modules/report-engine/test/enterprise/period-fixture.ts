import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import type { RoleBinding } from '../../templates/enterprise';
import { buildProfitSlice, type ProfitBindings } from '../../templates/enterprise/period-slice';
import { setupEnterpriseFixture, seedProfitClosing } from './fixture';

const mapped = (...accounts: string[]): RoleBinding => ({ state: 'mapped', accounts });
/** 全部是该测试账套的明确映射；没有发生的真实账户返回零，不使用常量零代替缺项。 */
export const profitBindings: ProfitBindings = {
  revenue: mapped('6001', '6051'),
  cost: mapped('6401'),
  taxes: mapped('6403'),
  selling: mapped('6601'),
  administration: mapped('6602'),
  research: mapped('6702'),
  finance: mapped('6603'),
  otherIncome: mapped('6117'),
  investmentIncome: mapped('6111'),
  hedgeIncome: mapped('6112'),
  fairValueIncome: mapped('6113'),
  creditImpairment: mapped('6114'),
  assetImpairment: mapped('6701'),
  disposalIncome: mapped('6115'),
  nonoperatingIncome: mapped('6301'),
  nonoperatingExpense: mapped('6711'),
  incomeTax: mapped('6801'),
};

export async function setupPeriodFixture(svc: CoreServices) {
  await svc.periods.ensureYear(2026);
  await setupEnterpriseFixture(svc);
  // 将原有固定账套的真实期初放到2025年；2026年未存年结期初，先由总账连续结转。
  const opening = await svc.opening.list(2026);
  await svc.tx(async (t) =>
    t.opening.replaceYear(
      2025,
      opening.map((r) => ({
        accountId: r.accountId,
        dimensions: r.dimensions,
        balance: r.balance,
        currency: r.currency,
        fcBalance: r.fcBalance,
        quantity: r.quantity,
      })),
    ),
  );
  for (const [code, name] of [
    ['6403', '测试税金及附加'],
    ['6702', '测试费用化研发'],
    ['6111', '测试投资收益'],
    ['6112', '测试净敞口套期损益'],
    ['6113', '测试公允价值变动'],
    ['6114', '测试信用减值'],
    ['6115', '测试资产处置'],
    ['6301', '测试营业外收入'],
    ['6711', '测试营业外支出'],
  ] as const)
    await svc.accounts.create(
      {
        code,
        name,
        categoryId: 'pnl',
        direction: ['6403', '6702', '6114', '6711'].includes(code) ? 'debit' : 'credit',
      },
      [4, 2, 2],
    );
  await svc.dimensions.create({
    type: 'cashflow',
    code: 'CF07',
    name: '测试税费返还（实际无发生）',
  });
  await seedVouchers(svc, [
    {
      date: '2025-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 1000, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 1000 },
      ],
    },
    {
      date: '2025-01-06',
      status: 'posted',
      lines: [
        { account: '6401', debit: 200 },
        { account: '1001', credit: 200, dims: { cashflow: 'CF02' } },
      ],
    },
    {
      date: '2025-12-01',
      status: 'posted',
      lines: [
        { account: '100201', debit: 2000, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 2000 },
      ],
    },
  ]);
  const input = await voucherInputFromSpec(svc, {
    date: '2025-12-31',
    lines: [
      { account: '6001', debit: 3000 },
      { account: '6401', credit: 200 },
      { account: '4103', credit: 2800 },
    ],
  });
  const priorClosing = await svc.vouchers.create({ ...input, closingKind: 'pnl' });
  await svc.vouchers.changeStatus({ ids: [priorClosing.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [priorClosing.id], to: 'posted' });
  await seedProfitClosing(svc);
}

export async function periodProfit(
  svc: CoreServices,
  scope: 'month' | 'yearToDate' = 'month',
  comparative = true,
) {
  return buildProfitSlice(
    profitBindings,
    await svc.accounts.list(),
    (await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id),
    { scope, ...(comparative ? { previous: profitBindings } : {}) },
  );
}

export async function seedReceivableReclassification(svc: CoreServices) {
  await svc.accounts.create(
    {
      code: '2203',
      name: '测试预收款',
      categoryId: 'liability',
      direction: 'credit',
      isPartner: true,
      dimensions: [{ type: 'partner' }],
    },
    [4, 2, 2],
  );
  await svc.accounts.create(
    { code: '1231', name: '测试专属应收坏账准备', categoryId: 'asset', direction: 'credit' },
    [4, 2, 2],
  );
  await svc.dimensions.create({ type: 'partner', code: 'C002', name: '测试第二往来对象' });
  await seedVouchers(svc, [
    {
      date: '2026-01-25',
      status: 'posted',
      lines: [
        { account: '1122', debit: 10000, dims: { partner: 'C001' } },
        { account: '4001', credit: 10000 },
      ],
    },
    {
      date: '2026-01-25',
      status: 'posted',
      lines: [
        { account: '1122', credit: 3000, dims: { partner: 'C002' } },
        { account: '4001', debit: 3000 },
      ],
    },
    {
      date: '2026-01-25',
      status: 'posted',
      lines: [
        { account: '2203', credit: 2000, dims: { partner: 'C001' } },
        { account: '4001', debit: 2000 },
      ],
    },
    {
      date: '2026-01-25',
      status: 'posted',
      lines: [
        { account: '2203', debit: 1000, dims: { partner: 'C002' } },
        { account: '4001', credit: 1000 },
      ],
    },
    {
      date: '2026-01-25',
      status: 'posted',
      lines: [
        { account: '1231', credit: 500 },
        { account: '4001', debit: 500 },
      ],
    },
  ]);
}
