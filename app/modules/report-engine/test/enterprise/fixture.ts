import type { Account, BalanceRow, EntryRow } from '@caiwu/core';
import {
  EnterpriseConfigSchema,
  FORMAT,
  type SourceData,
  type EnterpriseConfig,
} from '../../templates/enterprise/model';
export const provenance = { source: '合成账套会计政策及独立手工台账', version: '1' };
export function account(
  id: number,
  name: string,
  categoryId = 'asset',
  direction: 'debit' | 'credit' = 'debit',
): Account {
  return {
    id,
    code: String(8000 + id),
    name,
    fullName: name,
    parentId: null,
    level: 1,
    categoryId,
    direction,
    isLeaf: true,
    disabled: false,
    isCash: id === 1,
    isBank: false,
    cashflowRequired: false,
    isPartner: false,
    currency: null,
    quantityUnit: null,
    pinyin: '',
    mnemonic: null,
    dimensions: [],
  };
}
export function balance(
  a: Account,
  opening: number,
  closing: number,
  dimensions: BalanceRow['dimensions'] = {},
): BalanceRow {
  return {
    accountId: a.id,
    accountCode: a.code,
    accountName: a.name,
    level: a.level,
    isLeaf: true,
    direction: a.direction,
    dimensions,
    opening,
    closing,
    debit: 0,
    credit: 0,
    ytdDebit: 0,
    ytdCredit: 0,
    fcOpening: 0,
    fcDebit: 0,
    fcCredit: 0,
    fcClosing: 0,
    qtyOpening: '0',
    qtyDebit: '0',
    qtyCredit: '0',
    qtyClosing: '0',
  };
}
export function fixture(): { c: EnterpriseConfig; d: SourceData } {
  const accounts = [
    account(1, '库存现金'),
    account(2, '实收资本', 'equity', 'credit'),
    account(3, '主营业务收入', 'pnl', 'credit'),
    account(4, '主营业务成本', 'pnl'),
    account(5, '所得税费用', 'pnl'),
    account(6, '本年利润', 'equity', 'credit'),
    account(7, '利润分配', 'equity', 'credit'),
  ];
  const d: SourceData = {
    bookId: 'synthetic-enterprise',
    orgName: '合成企业',
    regime: 'enterprise',
    startPeriod: 202301,
    accounts,
    pnlCategoryIds: ['pnl'],
    balances: {},
    entries: [],
    vouchers: [],
    periods: [],
    cashflowItems: [],
    openingSources: [],
  };
  const c = EnterpriseConfigSchema.parse({
    format: FORMAT,
    period: 202512,
    scope: 'annual',
    adoption: {
      entityClass: 'unlisted',
      financial: '2020-01-01',
      revenue: '2020-01-01',
      lease: '2020-01-01',
      cas30_2026: null,
      ...provenance,
    },
    rules: [
      { accountId: 1, line: 'cash', kind: 'balance' },
      { accountId: 2, line: 'capital', kind: 'balance' },
      { accountId: 3, line: 'revenue', kind: 'pnl' },
      { accountId: 4, line: 'cost', kind: 'pnl' },
      { accountId: 5, line: 'incomeTax', kind: 'pnl' },
      { accountId: 6, line: 'retainedEarnings', kind: 'currentProfit' },
      { accountId: 7, line: 'retainedEarnings', kind: 'balance' },
    ],
    facts: [],
    absentRoles: [],
    cashPolicies: [],
    cashAllocations: [],
    cashScopeChanges: [],
    equityEvents: [],
    adjustments: [],
    oci: [],
    discontinued: [],
    shares: [],
    eps: [],
  });
  let voucherId = 0,
    lineId = 0;
  const voucher = (
    period: number,
    closingKind: string | null,
    rows: [number, number, number][],
  ) => {
    const id = ++voucherId,
      date = `${Math.floor(period / 100)}-${String(period % 100).padStart(2, '0')}-28`;
    d.vouchers.push({
      id,
      period,
      voucherTypeId: 1,
      voucherTypeCode: '记',
      number: id,
      displayNo: `记-${id}`,
      date,
      attachments: 0,
      status: 'posted',
      voided: false,
      reversalOfId: null,
      source:
        closingKind === 'pnl'
          ? { module: 'period-close', type: 'closing', id: `${period}:1` }
          : null,
      closingKind,
      note: null,
      debitTotal: rows.reduce((s, r) => s + r[1], 0),
      creditTotal: rows.reduce((s, r) => s + r[2], 0),
      summary: '合成业务',
      createdBy: { id: 1, name: '合成用户' },
      createdAt: date,
      updatedAt: date,
      auditedBy: null,
      auditedAt: null,
      postedBy: null,
      postedAt: null,
      revision: 1,
    });
    for (const [accountId, debit, credit] of rows) {
      const a = accounts.find((a) => a.id === accountId)!;
      const e: EntryRow = {
        voucherId: id,
        lineId: ++lineId,
        period,
        date,
        voucherTypeCode: '记',
        number: id,
        displayNo: `记-${id}`,
        status: 'posted',
        lineNo: rows.findIndex((x) => x[0] === accountId) + 1,
        summary: '合成业务',
        accountId,
        accountCode: a.code,
        dimensions: {},
        currency: null,
        exchangeRate: null,
        fcAmount: null,
        quantity: null,
        unitPrice: null,
        debit,
        credit,
        refNo: null,
        sourceModule: null,
      };
      d.entries.push(e);
      if (accountId === 1)
        c.cashAllocations.push({
          lineId: e.lineId,
          parts: [
            {
              line: debit ? 'salesReceipts' : credit === 4000 ? 'purchases' : 'taxPayments',
              amount: String(debit - credit),
            },
          ],
          ...provenance,
        });
    }
  };
  for (let y = 2023; y <= 2025; y++)
    for (let m = 1; m <= 12; m++) {
      const p = y * 100 + m;
      d.periods.push(p);
      if (y >= 2024) {
        voucher(p, null, [
          [1, 10000, 0],
          [3, 0, 10000],
        ]);
        voucher(p, null, [
          [4, 4000, 0],
          [1, 0, 4000],
        ]);
        voucher(p, null, [
          [5, 1000, 0],
          [1, 0, 1000],
        ]);
        voucher(p, 'pnl', [
          [3, 10000, 0],
          [4, 0, 4000],
          [5, 0, 1000],
          [6, 0, 5000],
        ]);
        if (m === 12)
          voucher(p, null, [
            [6, 60000, 0],
            [7, 0, 60000],
          ]);
      }
      const priorYears = Math.max(0, y - 2024),
        prior = priorYears * 60000,
        openingCash = 100000 + prior + (y >= 2024 ? (m - 1) * 5000 : 0),
        closingCash = openingCash + (y >= 2024 ? 5000 : 0);
      d.balances[p] = accounts.map((a) =>
        balance(
          a,
          a.id === 1
            ? openingCash
            : a.id === 2
              ? -100000
              : a.id === 6 && y >= 2024
                ? -(m - 1) * 5000
                : a.id === 7
                  ? -prior
                  : 0,
          a.id === 1
            ? closingCash
            : a.id === 2
              ? -100000
              : a.id === 6 && y >= 2024 && m !== 12
                ? -m * 5000
                : a.id === 7
                  ? -(prior + (m === 12 && y >= 2024 ? 60000 : 0))
                  : 0,
        ),
      );
      for (const basis of ['opening', 'closing'] as const)
        c.cashPolicies.push({
          period: p,
          basis,
          accounts: [1],
          restrictedAccounts: [],
          ...provenance,
        });
    }
  c.eps.push(
    { from: 202401, to: 202412, applicable: false, preference: '0', dilutions: [], ...provenance },
    { from: 202501, to: 202512, applicable: false, preference: '0', dilutions: [], ...provenance },
  );
  return { c, d };
}
export function addAccount(
  c: EnterpriseConfig,
  d: SourceData,
  a: Account,
  rule: EnterpriseConfig['rules'][number],
  amount: number,
  period = 202512,
  dimensions: BalanceRow['dimensions'] = {},
) {
  d.accounts.push(a);
  c.rules.push(rule);
  d.balances[period]!.push(balance(a, amount, amount, dimensions));
}
