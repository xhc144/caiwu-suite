import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import {
  annual,
  seedFullYear,
  confirmFixture,
  closePnl,
  blankConfiguration,
  balanceFacts,
} from './fixture';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import type { Configuration } from '../../templates/nonprofit/model';

let book: TestBook, previous: Configuration, current: Configuration;
const next = { ...annual, from: 202701, to: 202712 };
beforeEach(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  previous = await confirmFixture(book.svc, await seedFullYear(book.svc));
  await closePnl(book.svc);
  const closing = await book.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202612,
    rollup: false,
    includeZero: true,
    groupBy: ['partner', 'person'],
  });
  await book.svc.periods.ensureYear(2027, { openingStored: true });
  await book.svc.opening.replaceYear(
    2027,
    closing
      .filter((b) => b.isLeaf && b.closing !== 0)
      .map((b) => ({ accountId: b.accountId, dimensions: b.dimensions, balance: b.closing })),
  );
  current = blankConfiguration(book.info.id, 2027);
  current.resources[0]!.openingBalance = 312410;
  current.resources[1]!.openingBalance = 60570;
  current.comparison = {
    basis: '合成2026可比项目保持同一制度，必要重列逐笔记录',
    restatements: [],
  };
  const s = await readNonprofitSources(book.svc, next);
  current.balanceFacts = balanceFacts(s, current);
  // 此处仅配置真实2027两个时点合同分类，不用被测公式产生任何期望金额。
  for (const f of current.balanceFacts) {
    for (const a of f.allocations) {
      if (a.maturity) {
        const limit = f.at === '2027-01-01' ? '2028-01-01' : '2028-12-31';
        if (a.maturity <= limit) {
          if (['debtInvestment', 'otherInvestment'].includes(a.row)) a.row = 'currentInvestment';
          if (['longBorrowing', 'longPayables', 'otherLongLiabilities'].includes(a.row))
            a.row = 'currentDebt';
        }
      }
    }
  }
});
afterEach(async () => book?.close());
it('w_bb_proc 2027采用真实2026年度比较，年结承接后的2027年初仍完整填列', async () => {
  const b = await generateNonprofit(book.svc, next, current);
  expect(b.statement.rows.find((r) => r.id === 'cash')!.values).toEqual([326480, 326480]);
  const a = await generateNonprofit(book.svc, { ...next, code: '402' }, current, previous);
  expect(a.statement.rows.find((r) => r.id === 'donations')!.values).toEqual([
    0, 0, 0, 0, 0, 0, 12000, 12000,
  ]);
  expect(a.statement.rows.find((r) => r.id === 'netChange')!.values).toEqual([
    0, 0, 0, 0, 0, 0, 20470, 20470,
  ]);
  const cf = await generateNonprofit(book.svc, { ...next, code: '403' }, current, previous);
  expect(cf.statement.rows.find((r) => r.id === 'cashNet')!.values).toEqual([0, 26480]);
});
it('w_bb_get 2027不能沿用2026比较豁免或用0代替缺失上年来源', async () => {
  await expect(generateNonprofit(book.svc, { ...next, code: '402' }, current)).rejects.toThrow(
    /上年度真实来源/,
  );
  await expect(
    generateNonprofit(book.svc, { ...next, code: '403', comparison: false }, current, previous),
  ).rejects.toThrow(/2027年起/);
});
it('w_bb_proc 活动比较明细重列后重新计算全部合计，本期与累计使用实际期间范围', async () => {
  current.comparison!.restatements = [
    { code: '402', row: 'donations', period: 202602, amount: 100, basis: '合成原捐赠收入项目重列' },
    { code: '402', row: 'services', period: 202602, amount: -100, basis: '合成服务项目相应重列' },
  ];
  const { statement } = await generateNonprofit(
    book.svc,
    { ...next, code: '402' },
    current,
    previous,
  );
  expect(statement.rows.find((r) => r.id === 'donations')!.values.slice(6)).toEqual([12100, 12100]);
  expect(statement.rows.find((r) => r.id === 'services')!.values.slice(6)).toEqual([3500, 3500]);
  expect(statement.rows.find((r) => r.id === 'incomeTotal')!.values.slice(6)).toEqual([
    54000, 54000,
  ]);
  current.comparison!.restatements.pop();
  await expect(
    generateNonprofit(book.svc, { ...next, code: '402' }, current, previous),
  ).rejects.toThrow(/比较重列后净资产变动承接/);
});
it('w_bb_proc 现金比较重列后重新计算分组小计和净额，仍与真实上年现金首尾一致', async () => {
  current.comparison!.restatements = [
    { code: '403', row: 'donations', period: 202602, amount: 100, basis: '合成现金项目重列' },
    { code: '403', row: 'services', period: 202602, amount: -100, basis: '合成现金对应重列' },
  ];
  const { statement } = await generateNonprofit(
    book.svc,
    { ...next, code: '403' },
    current,
    previous,
  );
  expect(statement.rows.find((r) => r.id === 'donations')!.values).toEqual([0, 12100]);
  expect(statement.rows.find((r) => r.id === 'operatingReceipts')!.values).toEqual([0, 45680]);
  expect(statement.rows.find((r) => r.id === 'cashNet')!.values).toEqual([0, 26480]);
  current.comparison!.restatements.pop();
  await expect(
    generateNonprofit(book.svc, { ...next, code: '403' }, current, previous),
  ).rejects.toThrow(/比较重列后现金首尾/);
});

it('w_bb_proc 业务组成前后年度取并集，新项目比较为真实零发生，上年独有项目保留', async () => {
  const { seedVouchers } = await import('@caiwu/testkit');
  const { lineIdentity } = await import('../../templates/nonprofit/model');
  const [voucher] = await seedVouchers(book.svc, [
    {
      date: '2027-02-05',
      status: 'posted',
      summary: '合成2027新增教育项目',
      lines: [
        { account: '5101', debit: 100 },
        { account: '1002', credit: 100 },
      ],
    },
  ]);
  const s = await readNonprofitSources(book.svc, next),
    line = s.entries.find((e) => e.voucherId === voucher!.id && e.accountCode === '5101')!;
  current.recognitions = [
    {
      line: lineIdentity(line),
      row: 'activityCost',
      allocations: [
        {
          resourceId: 'U',
          classification: 'unrestricted',
          debit: 100,
          credit: 0,
          recognitionReference: '合成新项目实际使用',
          acquisitionReference: '合成资源取得U',
          detail: '2027新项目',
          charitableTrust: false,
          fundraisingCost: false,
        },
      ],
    },
  ];
  const cashFact = current.balanceFacts.find(
    (f) => f.at === '2027-12-31' && f.key.startsWith('1002:'),
  )!;
  cashFact.balance -= 100;
  cashFact.allocations[0]!.amount -= 100;
  const { statement } = await generateNonprofit(
    book.svc,
    { ...next, code: '402' },
    current,
    previous,
  );
  expect(statement.rows.find((r) => r.id === 'detail:2027新项目')!.values).toEqual([
    100, 0, 100, 100, 0, 100, 0, 0,
  ]);
  expect(statement.rows.find((r) => r.id === 'detail:合成教育活动')!.values).toEqual([
    0, 0, 0, 0, 0, 0, 720, 720,
  ]);
  expect(statement.rows.find((r) => r.id === 'detail:合成慈善信托')!.values).toEqual([
    0, 0, 0, 0, 0, 0, 480, 480,
  ]);
});
