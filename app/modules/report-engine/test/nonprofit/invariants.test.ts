import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, seedFullYear, confirmFixture } from './fixture';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { classifyNetAssetEvents } from '../../templates/nonprofit/activity';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import { lineIdentity, type Configuration } from '../../templates/nonprofit/model';

let book: TestBook, c: Configuration;
beforeAll(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  c = await confirmFixture(book.svc, await seedFullYear(book.svc));
});
afterAll(async () => book?.close());
it('w_bb_proc fast-check 同一实际分录多资源拆分借贷守恒，分类总额与净资产首尾一致', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), async (n) => {
      const draft = structuredClone(c),
        r = draft.recognitions.find((r) => r.line.account === '4101')!;
      r.allocations[0]!.credit = n;
      r.allocations[1]!.credit = 1000 - n;
      const { statement } = await generateNonprofit(book.svc, { ...annual, code: '402' }, draft);
      const row = statement.rows.find((r) => r.id === 'donations')!;
      expect(row.values[2]).toBe(12000);
      expect(Number(row.values[0]) + Number(row.values[1])).toBe(12000);
      expect(statement.checks.every((c) => c.difference === 0)).toBe(true);
    }),
    { numRuns: 25 },
  );
});
it('w_bb_proc fast-check 真实互转按资源拆分，两类合计恒为零且不重复计入净变动', async () => {
  const sources = await readNonprofitSources(book.svc, annual);
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 49 }), (n) => {
      const draft = structuredClone(c);
      const original = draft.events[0]!;
      const second = structuredClone(original);
      second.id = '合成同凭证第二批解除';
      second.resourceId = 'R2';
      second.amount = 50 - n;
      const resource = structuredClone(draft.resources[1]!);
      resource.id = 'R2';
      resource.name = '合成第二限定批次';
      resource.openingBalance = 100;
      resource.restriction!.resourceReference = 'R2';
      draft.resources[1]!.openingBalance -= 100;
      draft.resources.push(resource);
      original.amount = n;
      for (const line of original.lines) {
        line.debit = line.line.debit ? n : 0;
        line.credit = line.line.credit ? n : 0;
      }
      for (const line of second.lines) {
        line.debit = line.line.debit ? 50 - n : 0;
        line.credit = line.line.credit ? 50 - n : 0;
      }
      second.restriction!.resourceReference = 'R2';
      draft.events.push(second);
      const rows = classifyNetAssetEvents(sources, draft).filter((r) => r.row === 'release');
      expect(rows.reduce((a, b) => a + b.amount, 0)).toBe(0);
      expect(rows.filter((r) => r.kind === 'unrestricted').reduce((a, b) => a + b.amount, 0)).toBe(
        50,
      );
    }),
    { numRuns: 30 },
  );
});
it('w_bb_proc fast-check 一笔现金多项目拆分守恒，内部划转不重计现金净增加', async () => {
  const [v] = await seedVouchers(book.svc, [
    {
      date: '2026-12-20',
      status: 'posted',
      summary: '合成内部划转',
      lines: [
        { account: '1002', debit: 400 },
        { account: '1001', credit: 400 },
      ],
    },
  ]);
  const sources = await readNonprofitSources(book.svc, { ...annual, code: '403' });
  const draft = structuredClone(c);
  for (const e of sources.entries.filter((e) => e.voucherId === v!.id))
    draft.cashConfirmations.push({
      line: lineIdentity(e),
      allocations: [
        {
          row: 'internal',
          amount: e.debit - e.credit,
          sourceReference: '合成内部划转对应凭据',
          transferReference: '合成内部划转编号',
          nature: 'ordinary',
        },
      ],
    });
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), async (n) => {
      const x = structuredClone(draft),
        f = x.cashConfirmations.find((f) => f.allocations[0]!.row === 'donations')!;
      f.allocations = [
        { row: 'donations', amount: n, sourceReference: '合成分配第一部分', nature: 'ordinary' },
        {
          row: 'services',
          amount: 1000 - n,
          sourceReference: '合成分配第二部分',
          nature: 'ordinary',
        },
      ];
      const { statement } = await generateNonprofit(book.svc, { ...annual, code: '403' }, x);
      expect(statement.rows.find((r) => r.id === 'cashNet')!.values[0]).toBe(26480);
      expect(statement.checks.every((c) => c.difference === 0)).toBe(true);
    }),
    { numRuns: 25 },
  );
});
