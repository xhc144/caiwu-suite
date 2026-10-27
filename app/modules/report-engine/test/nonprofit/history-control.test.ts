import { expect, it } from 'vitest';
import type { CoreServices } from '@caiwu/core/server';
import { mergePreStartHistory } from '../../templates/nonprofit/history.server';
import { parseHistoryEntries, parseHistoryOpening } from '../../templates/nonprofit/history-import';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { lineIdentity, mappedRow, type Sources } from '../../templates/nonprofit/model';
import { blankConfiguration, annual } from './fixture';

function fixture() {
  const c = blankConfiguration('合成年中启用');
  c.mappings = [];
  c.resources.forEach((r) => (r.openingBalance = 0));
  c.cashScope = c.cashScope.filter((r) => r.account === '1002');
  const s = {
    book: {
      id: c.bookId,
      regime: 'nonprofit',
      templateId: 'nonprofit-2026',
      startPeriod: 202607,
      orgName: '合成年中组织',
    },
    from: 202607,
    to: 202612,
    openingDate: '2026-07-01',
    closingDate: '2026-12-31',
    unpostedCount: 0,
    accounts: ['1002', '3101', '4101', '5101'].map((code, i) => ({
      id: i + 1,
      code,
      name: code,
      level: 1,
      isLeaf: true,
      isBank: code === '1002',
      direction: ['3101', '4101'].includes(code) ? 'credit' : 'debit',
      categoryId:
        code === '1002'
          ? 'asset'
          : code === '3101'
            ? 'net-assets'
            : code === '4101'
              ? 'revenue'
              : 'expense',
    })),
    categories: [
      { id: 'asset', direction: 'debit' },
      { id: 'net-assets', direction: 'credit' },
      { id: 'revenue', direction: 'credit', isPnl: true },
      { id: 'expense', direction: 'debit', isPnl: true },
    ],
    balances: [
      { accountId: 1, accountCode: '1002', opening: 50, debit: 20, credit: 10, closing: 60 },
      { accountId: 2, accountCode: '3101', opening: -50, debit: 0, credit: 0, closing: -50 },
      { accountId: 3, accountCode: '4101', opening: 0, debit: 0, credit: 20, closing: -20 },
      { accountId: 4, accountCode: '5101', opening: 0, debit: 10, credit: 0, closing: 10 },
    ].map((b) => ({
      ...b,
      dimensions: {},
      isLeaf: true,
      accountName: b.accountCode,
      level: 1,
      direction: b.accountId === 2 || b.accountId === 3 ? 'credit' : 'debit',
      ytdDebit: b.debit,
      ytdCredit: b.credit,
    })),
    entries: [
      { voucherId: 1, accountCode: '1002', debit: 20, credit: 0 },
      { voucherId: 1, accountCode: '4101', debit: 0, credit: 20 },
      { voucherId: 2, accountCode: '5101', debit: 10, credit: 0 },
      { voucherId: 2, accountCode: '1002', debit: 0, credit: 10 },
    ].map((e, i) => ({
      ...e,
      accountId: ['1002', '3101', '4101', '5101'].indexOf(e.accountCode) + 1,
      lineId: i + 1,
      lineNo: (i % 2) + 1,
      date: '2026-07-05',
      period: 202607,
      revision: 1,
      closingKind: null,
      dimensions: {},
      displayNo: `记-${e.voucherId}`,
      status: 'posted',
    })),
    dimensionItems: [],
    dimensionNames: {},
  } as unknown as Sources;
  c.preStartHistory = {
    basis: '合成年度年初及一至六月完整已过账原账',
    postedConfirmed: true,
    from: 202601,
    to: 202606,
    periods: [202601, 202602, 202603, 202604, 202605, 202606],
    opening: ['1002', '3101', '4101', '5101'].map((account) => ({
      account,
      balance: 0,
      sourceReference: '合成零余额年度年初清单',
    })),
    entries: [
      ['A', 1, '1002', 100, 0, null],
      ['A', 2, '4101', 0, 100, null],
      ['B', 1, '5101', 50, 0, null],
      ['B', 2, '1002', 0, 50, null],
      ['C', 1, '4101', 100, 0, 'pnl'],
      ['C', 2, '3101', 0, 100, 'pnl'],
      ['D', 1, '3101', 50, 0, 'pnl'],
      ['D', 2, '5101', 0, 50, 'pnl'],
    ].map((v) => ({
      voucher: String(v[0]),
      line: Number(v[1]),
      account: String(v[2]),
      debit: Number(v[3]),
      credit: Number(v[4]),
      closingKind: v[5] as string | null,
      date: '2026-01-31',
      revision: 1,
      sourceReference: `合成原始凭据${v[0]}`,
    })),
  };
  return { s, c };
}

it('w_bb_proc 年中启用来源逐科目承接，生产生成函数三表保留真实年初、启用前及累计金额', async () => {
  const { s, c } = fixture(),
    all = mergePreStartHistory(s, c.preStartHistory, 202612);
  c.recognitions = all.entries
    .filter((e) => !e.closingKind && ['4101', '5101'].includes(e.accountCode))
    .map((e) => ({
      line: lineIdentity(e),
      row: mappedRow(e.accountCode, []) as 'donations' | 'activityCost',
      allocations: [
        {
          resourceId: 'U',
          classification: 'unrestricted',
          debit: e.debit,
          credit: e.credit,
          acquisitionReference: '合成资源取得U',
          recognitionReference: '合成逐笔核对',
          detail: '教育服务',
          charitableTrust: false,
          fundraisingCost: false,
        },
      ],
    }));
  // 收入分配不能写业务成本组成。
  for (const r of c.recognitions.filter((r) => r.row === 'donations'))
    delete r.allocations[0]!.detail;
  c.cashConfirmations = all.entries
    .filter((e) => e.accountCode === '1002')
    .map((e) => ({
      line: lineIdentity(e),
      allocations: [
        {
          row: e.debit ? 'donations' : 'goodsServicesPaid',
          amount: e.debit - e.credit,
          sourceReference: '合成实际现金收支凭据',
          nature: 'ordinary',
        },
      ],
    }));
  const svc = {
    book: { info: async () => s.book },
    accounts: { list: async () => s.accounts, categories: async () => s.categories },
    periods: { require: async () => ({}) },
    dimensions: { items: async () => [] },
    ledger: { balances: async () => s.balances, entries: async () => s.entries },
    vouchers: {
      list: async () => ({ total: 0 }),
      get: async (id: number) => ({ id, revision: 1, closingKind: null }),
    },
  } as unknown as CoreServices;
  const b = await generateNonprofit(svc, annual, c);
  expect(b.statement.rows.find((r) => r.id === 'cash')!.values).toEqual([0, 60]);
  expect(b.statement.rows.find((r) => r.id === 'unrestricted')!.values).toEqual([0, 60]);
  const a = await generateNonprofit(svc, { ...annual, code: '402' }, c);
  expect(a.statement.rows.find((r) => r.id === 'donations')!.values).toEqual([
    120, 0, 120, 120, 0, 120,
  ]);
  expect(a.statement.rows.find((r) => r.id === 'activityCost')!.values).toEqual([
    60, 0, 60, 60, 0, 60,
  ]);
  expect(a.statement.rows.find((r) => r.id === 'netChange')!.values).toEqual([
    60, 0, 60, 60, 0, 60,
  ]);
  const cf = await generateNonprofit(svc, { ...annual, code: '403' }, c);
  expect(cf.statement.rows.find((r) => r.id === 'cashNet')!.values).toEqual([
    60,
    '不要求填列（2026年首次执行）',
  ]);
  const omitted = structuredClone(c);
  omitted.recognitions = omitted.recognitions.filter((r) => r.line.lineId > 0);
  await expect(generateNonprofit(svc, { ...annual, code: '402' }, omitted)).rejects.toThrow(
    /逐笔确认不完整/,
  );
});

it('w_bb_get 启用前缺月、凭证不平、对象未对应和错承接不能作为零来源', () => {
  const { s, c } = fixture();
  const h = c.preStartHistory!;
  const missing = structuredClone(h);
  missing.periods.pop();
  expect(() => mergePreStartHistory(s, missing, 202612)).toThrow(/逐月完整/);
  const bad = structuredClone(h);
  bad.entries[0]!.debit++;
  expect(() => mergePreStartHistory(s, bad, 202612)).toThrow(/借贷不平/);
  const wrong = structuredClone(s);
  wrong.balances[0]!.opening++;
  expect(() => mergePreStartHistory(wrong, h, 202612)).toThrow(/实际启用期初/);
  const partner = structuredClone(h);
  partner.entries[0]!.partner = 99;
  expect(() => mergePreStartHistory(s, partner, 202612)).toThrow(/真实档案/);
});

it('w_bb_proc 原凭证内容变化使历史来源身份变化，不借负编号跳转到核心凭证', () => {
  const { s, c } = fixture();
  const original = mergePreStartHistory(s, c.preStartHistory, 202612);
  const h = structuredClone(c.preStartHistory!);
  h.entries[0]!.sourceReference = '合成已修订原始凭据';
  const changed = mergePreStartHistory(s, h, 202612);
  expect(original.entries[0]!.lineId).toBeLessThan(0);
  expect(changed.entries[0]!.revision).not.toBe(original.entries[0]!.revision);
});

it('w_bb_get CSV金额精确到分，保留红字原侧和明确结转类别，不把空金额当0', () => {
  const { s } = fixture();
  expect(parseHistoryOpening('科目编码,年初余额,原始凭据\n1002,0.01,合成原件', s)[0]!.balance).toBe(
    1,
  );
  const header = '日期,凭证编号,行号,原版本,科目编码,借方金额,贷方金额,结转类别,原始凭据\n';
  expect(
    parseHistoryEntries(header + '2026-01-05,记1,1,1,1002,-0.01,0,普通业务,合成红字原件', s)[0]!
      .debit,
  ).toBe(-1);
  expect(() =>
    parseHistoryEntries(header + '2026-01-05,记1,1,1,1002,,0,普通业务,合成原件', s),
  ).toThrow(/空金额/);
});
