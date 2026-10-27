import { it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateEnterprise } from '../../templates/enterprise/calculate';
import {
  balanceBucket,
  type EnterpriseConfig,
  type SourceData,
} from '../../templates/enterprise/model';
import { fixture, account, balance, provenance } from './fixture';
function extend(
  c: EnterpriseConfig,
  d: SourceData,
  id: number,
  name: string,
  line: string,
  kind: EnterpriseConfig['rules'][number]['kind'] = 'balance',
) {
  const a = account(
    id,
    name,
    ['otherComprehensive', 'surplusReserve', 'otherEquity'].includes(line) ? 'equity' : 'asset',
    line === 'otherCurrentAssets' ? 'debit' : 'credit',
  );
  d.accounts.push(a);
  c.rules.push({ accountId: id, line, kind, role: 'gross' });
  for (const rows of Object.values(d.balances)) rows.push(balance(a, 0, 0));
  return a;
}
function journal(
  c: EnterpriseConfig,
  d: SourceData,
  rows: {
    accountId: number;
    debit: number;
    credit: number;
    event?: {
      row: EnterpriseConfig['equityEvents'][number]['row'];
      column: EnterpriseConfig['equityEvents'][number]['parts'][number]['column'];
      amount: string;
    };
    cash?: { line: string; amount: string }[];
  }[],
) {
  const voucherId = Math.max(...d.vouchers.map((v) => v.id)) + 1,
    base = d.vouchers[0]!;
  d.vouchers.push({
    ...base,
    id: voucherId,
    period: 202512,
    date: '2025-12-29',
    displayNo: `记-${voucherId}`,
    source: null,
    closingKind: null,
    debitTotal: rows.reduce((s, x) => s + x.debit, 0),
    creditTotal: rows.reduce((s, x) => s + x.credit, 0),
  });
  const lines = rows.map((r, i) => ({
    ...d.entries[0]!,
    voucherId,
    lineId: 9000 + voucherId * 10 + i,
    period: 202512,
    date: '2025-12-29',
    displayNo: `记-${voucherId}`,
    lineNo: i + 1,
    accountId: r.accountId,
    accountCode: d.accounts.find((a) => a.id === r.accountId)!.code,
    debit: r.debit,
    credit: r.credit,
  }));
  d.entries.push(...lines);
  rows.forEach((r, i) => {
    const line = lines[i]!;
    d.balances[202512]!.find((b) => b.accountId === r.accountId)!.closing += r.debit - r.credit;
    if (r.event)
      c.equityEvents.push({
        lineId: line.lineId,
        row: r.event.row,
        liabilityAmount: '0',
        parts: [{ column: r.event.column, amount: r.event.amount }],
        ...provenance,
      });
    if (r.cash) c.cashAllocations.push({ lineId: line.lineId, parts: r.cash, ...provenance });
  });
  return lines;
}
it('w_bb_proc 税后OCI、投入、分配、提取盈余及内部结转与三表逐列闭合', () => {
  const { c, d } = fixture();
  extend(c, d, 8, '其他综合收益', 'otherComprehensive', 'oci');
  extend(c, d, 9, '其他资产', 'otherCurrentAssets');
  extend(c, d, 10, '盈余公积', 'surplusReserve');
  const oci = journal(c, d, [
    { accountId: 9, debit: 700, credit: 0 },
    { accountId: 8, debit: 0, credit: 700 },
  ]);
  c.oci.push({
    lineId: oci[1]!.lineId,
    line: 'otherEquityFairValue',
    gross: '1000',
    tax: '300',
    ...provenance,
  });
  journal(c, d, [
    { accountId: 1, debit: 1000, credit: 0, cash: [{ line: 'capitalReceipts', amount: '1000' }] },
    {
      accountId: 2,
      debit: 0,
      credit: 1000,
      event: { row: 'ordinaryContributions', column: 'capital', amount: '1000' },
    },
  ]);
  journal(c, d, [
    {
      accountId: 7,
      debit: 200,
      credit: 0,
      event: { row: 'distributions', column: 'retainedEarnings', amount: '-200' },
    },
    {
      accountId: 1,
      debit: 0,
      credit: 200,
      cash: [{ line: 'dividendInterestPayments', amount: '-200' }],
    },
  ]);
  journal(c, d, [
    {
      accountId: 7,
      debit: 200,
      credit: 0,
      event: { row: 'surplusAppropriation', column: 'retainedEarnings', amount: '-200' },
    },
    {
      accountId: 10,
      debit: 0,
      credit: 200,
      event: { row: 'surplusAppropriation', column: 'surplusReserve', amount: '200' },
    },
  ]);
  journal(c, d, [
    {
      accountId: 10,
      debit: 100,
      credit: 0,
      event: { row: 'capitalizationSurplus', column: 'surplusReserve', amount: '-100' },
    },
    {
      accountId: 2,
      debit: 0,
      credit: 100,
      event: { row: 'capitalizationSurplus', column: 'capital', amount: '100' },
    },
  ]);
  const r = calculateEnterprise(c, d);
  expect(r.profit.current.oci).toBe('700');
  expect(r.profit.current.comprehensiveIncome).toBe('60700');
  expect(r.cashflow.current.capitalReceipts).toBe('1000');
  expect(r.cashflow.current.dividendInterestPayments).toBe('200');
  expect(r.balance.current.capital).toBe('101100');
  expect(r.balance.current.surplusReserve).toBe('100');
  expect(r.balance.current.retainedEarnings).toBe('119600');
  expect(r.equity.current.closing).toEqual({
    capital: '101100',
    equityPreferred: '0',
    equityPerpetual: '0',
    equityOther: '0',
    capitalReserve: '0',
    treasuryStock: '0',
    otherComprehensive: '700',
    specialReserve: '0',
    surplusReserve: '100',
    retainedEarnings: '119600',
    total: '221500',
  });
  expect(r.checks.every((x) => x.difference === '0')).toBe(true);
  c.oci[0]!.tax = '200';
  expect(() => calculateEnterprise(c, d)).toThrow('税后净额与账务不一致');
});
it('w_bb_proc 同笔混合金融工具投入，负债和不同权益列分项独立守恒', () => {
  const { c, d } = fixture(),
    a = extend(c, d, 8, '混合金融工具', 'otherEquity', 'equityInstrument');
  const parts = [
    {
      id: '优先股甲',
      amount: '-3000',
      classification: 'equity' as const,
      instrument: 'preferred' as const,
      ...provenance,
    },
    {
      id: '永续甲',
      amount: '-4000',
      classification: 'equity' as const,
      instrument: 'perpetual' as const,
      ...provenance,
    },
    {
      id: '债务甲',
      amount: '-2000',
      classification: 'liability' as const,
      instrument: 'other' as const,
      duePeriod: 202812,
      current: false,
      ...provenance,
    },
  ];
  for (const [period, basis] of [
    [202312, 'closing'],
    [202401, 'opening'],
    [202412, 'closing'],
    [202501, 'opening'],
    [202512, 'closing'],
  ] as const)
    c.facts.push({
      period,
      basis,
      bucket: balanceBucket(balance(a, 0, 0)),
      parts: parts.map((p) => ({ ...p, amount: period === 202512 ? p.amount : '0' })),
      ...provenance,
    });
  const entries = journal(c, d, [
    {
      accountId: 1,
      debit: 9000,
      credit: 0,
      cash: [
        { line: 'capitalReceipts', amount: '7000' },
        { line: 'loanReceipts', amount: '2000' },
      ],
    },
    { accountId: 8, debit: 0, credit: 9000 },
  ]);
  c.equityEvents.push({
    lineId: entries[1]!.lineId,
    row: 'instrumentContributions',
    liabilityAmount: '2000',
    parts: [
      { column: 'equityPreferred', amount: '3000', instrumentId: '优先股甲' },
      { column: 'equityPerpetual', amount: '4000', instrumentId: '永续甲' },
    ],
    ...provenance,
  });
  const r = calculateEnterprise(c, d);
  expect(r.balance.current.bondsPayable).toBe('2000');
  expect(r.balance.current.otherEquity).toBe('7000');
  expect(r.equity.current.instrumentContributions!.equityPreferred).toBe('3000');
  expect(r.equity.current.instrumentContributions!.equityPerpetual).toBe('4000');
  expect(r.equity.current.instrumentContributions!.total).toBe('7000');
  expect(r.checks.every((x) => x.difference === '0')).toBe(true);
});
it('w_bb_proc fast-check 权益内部结转的每个事项和总权益都守恒', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 10000 }), (n) => {
      const { c, d } = fixture();
      extend(c, d, 8, '盈余公积', 'surplusReserve');
      journal(c, d, [
        {
          accountId: 7,
          debit: n,
          credit: 0,
          event: { row: 'lossRecovery', column: 'retainedEarnings', amount: String(-n) },
        },
        {
          accountId: 8,
          debit: 0,
          credit: n,
          event: { row: 'lossRecovery', column: 'surplusReserve', amount: String(n) },
        },
      ]);
      const r = calculateEnterprise(c, d);
      expect(r.equity.current.transfers!.total).toBe('0');
      expect(r.equity.current.closing!.total).toBe('220000');
      expect(r.checks.every((x) => x.difference === '0')).toBe(true);
    }),
  );
});
