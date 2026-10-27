import { afterEach, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, blankConfiguration } from './fixture';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import { lineIdentity, type Configuration } from '../../templates/nonprofit/model';

let book: TestBook;
afterEach(async () => book?.close());
it('w_bb_proc年度403每项目手算：多项目、退款、处置净收支、工程薪酬、筹资、汇兑、内部划转与非现金', async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  await book.svc.opening.upsert({
    year: 2026,
    accountId: (await book.svc.accounts.require('1001')).id,
    balance: 100000,
  });
  const c = blankConfiguration(book.info.id);
  c.cashConfirmations = [];
  const planned = new Map<number, Configuration['cashConfirmations'][number]['allocations']>();
  const post = async (
    lines: { account: string; debit?: number; credit?: number }[],
    allocations: Configuration['cashConfirmations'][number]['allocations'],
    nature = '合成现金凭据',
  ) => {
    const v = (
      await seedVouchers(book.svc, [
        { date: '2026-02-05', status: 'posted', summary: nature, lines },
      ])
    )[0]!;
    for (const l of v.lines.filter((l) => l.accountCode === '1002')) planned.set(l.id, allocations);
    return v;
  };
  const alloc = (
    row: Configuration['cashConfirmations'][number]['allocations'][number]['row'],
    amount: number,
    nature: Configuration['cashConfirmations'][number]['allocations'][number]['nature'] = 'ordinary',
  ) => ({ row, amount, sourceReference: '合成逐笔对应单据', nature });
  await post(
    [
      { account: '1002', debit: 300 },
      { account: '4101', credit: 100 },
      { account: '4201', credit: 100 },
      { account: '4301', credit: 100 },
    ],
    [alloc('donations', 100), alloc('dues', 100), alloc('services', 100)],
  );
  for (const [row, account] of [
    ['sales', '4501'],
    ['grants', '4401'],
    ['otherOperatingReceipts', '4901'],
    ['investmentRecovered', '1101'],
    ['investmentIncome', '4601'],
    ['assetDisposal', '1509'],
    ['otherInvestingReceipts', '1122'],
    ['borrowings', '2101'],
    ['otherFinancingReceipts', '2502'],
  ] as const)
    await post(
      [
        { account: '1002', debit: 100 },
        { account, credit: 100 },
      ],
      [alloc(row, 100)],
    );
  for (const [row, account] of [
    ['donationsPaid', '5101'],
    ['employeesPaid', '2204'],
    ['goodsServicesPaid', '1201'],
    ['taxesPaid', '2206'],
    ['otherOperatingPayments', '5301'],
    ['assetPurchase', '1505'],
    ['investmentPaid', '1101'],
    ['otherInvestingPayments', '1122'],
    ['principalPaid', '2101'],
    ['interestPaid', '1505'],
    ['otherFinancingPayments', '2502'],
  ] as const)
    await post(
      [
        { account, debit: 70 },
        { account: '1002', credit: 70 },
      ],
      [
        alloc(
          row,
          -70,
          row === 'assetPurchase'
            ? 'engineeringPayroll'
            : row === 'interestPaid'
              ? 'capitalizedInterest'
              : row === 'otherFinancingPayments'
                ? 'financeLease'
                : 'ordinary',
        ),
      ],
    );
  await post(
    [
      { account: '4101', debit: 10 },
      { account: '1002', credit: 10 },
    ],
    [alloc('donations', -10)],
    '合成退回原捐赠',
  );
  await post(
    [
      { account: '1509', debit: 20 },
      { account: '1002', credit: 20 },
    ],
    [alloc('assetDisposal', -20, 'disposal')],
    '合成处置费用',
  );
  await post(
    [
      { account: '1002', debit: 12 },
      { account: '5401', credit: 12 },
    ],
    [alloc('fx', 12)],
    '合成真实汇兑折算差额',
  );
  const transfer = await post(
    [
      { account: '1002', debit: 40 },
      { account: '1001', credit: 40 },
    ],
    [{ ...alloc('internal', 40), transferReference: '合成现金划转01' }],
  );
  const s = await readNonprofitSources(book.svc, { ...annual, code: '403' });
  for (const e of s.entries.filter((e) => ['1001', '1002'].includes(e.accountCode)))
    c.cashConfirmations.push({
      line: lineIdentity(e),
      allocations: planned.get(e.lineId) ?? [
        { ...alloc('internal', -40), transferReference: '合成现金划转01' },
      ],
    });
  expect(transfer.lines).toHaveLength(2);
  await seedVouchers(book.svc, [
    {
      date: '2026-02-06',
      status: 'posted',
      summary: '合成非现金购入固定资产',
      lines: [
        { account: '1501', debit: 100 },
        { account: '220201', credit: 100 },
      ],
    },
  ]);
  const { statement } = await generateNonprofit(book.svc, { ...annual, code: '403' }, c);
  const expected = {
    donations: 90,
    dues: 100,
    services: 100,
    sales: 100,
    grants: 100,
    otherOperatingReceipts: 100,
    operatingReceipts: 590,
    donationsPaid: 70,
    employeesPaid: 70,
    goodsServicesPaid: 70,
    taxesPaid: 70,
    otherOperatingPayments: 70,
    operatingPayments: 350,
    operatingNet: 240,
    investmentRecovered: 100,
    investmentIncome: 100,
    assetDisposal: 80,
    otherInvestingReceipts: 100,
    investingReceipts: 380,
    assetPurchase: 70,
    investmentPaid: 70,
    otherInvestingPayments: 70,
    investingPayments: 210,
    investingNet: 170,
    borrowings: 100,
    otherFinancingReceipts: 100,
    financingReceipts: 200,
    principalPaid: 70,
    interestPaid: 70,
    otherFinancingPayments: 70,
    financingPayments: 210,
    financingNet: -10,
    fx: 12,
    cashNet: 412,
  };
  expect(
    Object.fromEntries(statement.rows.filter((r) => !r.section).map((r) => [r.id, r.values[0]])),
  ).toEqual(expected);
  expect(statement.cashOpening).toBe(100000);
  expect(statement.cashClosing).toBe(100412);
  const wrong = structuredClone(c);
  wrong.cashConfirmations.find((f) =>
    f.allocations.some((a) => a.nature === 'engineeringPayroll'),
  )!.allocations[0]!.row = 'employeesPaid';
  await expect(generateNonprofit(book.svc, { ...annual, code: '403' }, wrong)).rejects.toThrow(
    /在建工程人员薪酬/,
  );
  const missing = structuredClone(c);
  missing.cashConfirmations = missing.cashConfirmations.filter((f) => f.line.account !== '1001');
  await expect(generateNonprofit(book.svc, { ...annual, code: '403' }, missing)).rejects.toThrow(
    /未完整覆盖/,
  );
});

it('w_bb_proc 真实现金等价物到期转银行属于现金范围内部划转，首尾与净增加不重计', async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  for (const [code, balance] of [
    ['1001', 100000],
    ['1101', 10000],
    ['3101', -110000],
  ] as const)
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require(code)).id,
      balance,
    });
  const [voucher] = await seedVouchers(book.svc, [
    {
      date: '2026-02-01',
      status: 'posted',
      summary: '合成到期短期低风险现金等价物转银行',
      lines: [
        { account: '1002', debit: 10000 },
        { account: '1101', credit: 10000 },
      ],
    },
  ]);
  const c = blankConfiguration(book.info.id);
  c.resources[0]!.openingBalance = 110000;
  c.resources[1]!.openingBalance = 0;
  c.cashScope.push({
    account: '1101',
    included: true,
    equivalent: true,
    agency: false,
    restricted: false,
    basis: '合成短期高流动低风险凭据',
    acquiredOn: '2025-12-01',
    maturity: '2026-02-28',
    riskBasis: '可随时按已知金额转换，无重大价值风险',
  });
  const s = await readNonprofitSources(book.svc, { ...annual, code: '403' });
  c.cashConfirmations = s.entries
    .filter((e) => e.voucherId === voucher!.id)
    .map((e) => ({
      line: lineIdentity(e),
      allocations: [
        {
          row: 'internal',
          amount: e.debit - e.credit,
          sourceReference: '合成现金等价物到期收回',
          transferReference: '合成到期收回编号',
          nature: 'ordinary',
        },
      ],
    }));
  const { statement } = await generateNonprofit(book.svc, { ...annual, code: '403' }, c);
  expect(statement.cashOpening).toBe(110000);
  expect(statement.cashClosing).toBe(110000);
  expect(statement.rows.find((r) => r.id === 'cashNet')!.values[0]).toBe(0);
  expect(statement.rows.find((r) => r.id === 'investmentRecovered')!.values[0]).toBe(0);
});
