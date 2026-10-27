import { expect, it } from 'vitest';
import { createTestBook, seedVouchers } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, blankConfiguration } from './fixture';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { lineIdentity, type Configuration } from '../../templates/nonprofit/model';

it('w_bb_proc 后续收入和外部设限不改变此前真实非限定性亏空的历史报表', async () => {
  const book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  try {
    await seedVouchers(book.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5301', debit: 100 },
          { account: '1002', credit: 100 },
        ],
      },
      {
        date: '2026-12-05',
        status: 'posted',
        lines: [
          { account: '1002', debit: 200 },
          { account: '4101', credit: 200 },
        ],
      },
    ]);
    const [v] = await seedVouchers(book.svc, [
      {
        date: '2026-12-10',
        status: 'posted',
        lines: [
          { account: '3101', debit: 100 },
          { account: '3102', credit: 100 },
        ],
      },
    ]);
    const c = blankConfiguration(book.info.id);
    c.resources.forEach((r) => (r.openingBalance = 0));
    const s = await readNonprofitSources(book.svc, annual);
    c.recognitions = s.entries
      .filter((e) => ['5301', '4101'].includes(e.accountCode))
      .map((e) => ({
        line: lineIdentity(e),
        row: e.accountCode === '5301' ? 'administration' : 'donations',
        allocations: [
          {
            resourceId: 'U',
            classification: 'unrestricted',
            debit: e.debit,
            credit: e.credit,
            recognitionReference: '合成实际取得与支出',
            acquisitionReference: '合成资源取得U',
            charitableTrust: false,
            fundraisingCost: false,
          },
        ],
      }));
    c.events = [
      {
        id: '合成未来设限',
        kind: 'restriction',
        date: v!.date,
        resourceId: 'U',
        amount: 100,
        sourceReference: '合成十二月外部限制文件',
        lines: s.entries
          .filter((e) => e.voucherId === v!.id)
          .map((e) => ({ line: lineIdentity(e), debit: e.debit, credit: e.credit })),
        restriction: {
          authority: 'lawOrRegulation',
          issuer: '合成法规主体',
          sourceReference: '合成十二月外部限制文件',
          resourceReference: 'U',
          specificClause: '十二月新增具体限制',
          purpose: { description: '合成指定用途' },
        },
      },
    ];
    const request = {
      ...annual,
      code: '402' as const,
      kind: 'month' as const,
      from: 202601,
      to: 202601,
    };
    const { statement } = await generateNonprofit(book.svc, request, c);
    expect(statement.rows.find((r) => r.id === 'netChange')!.values).toEqual([
      -100, 0, -100, -100, 0, -100,
    ]);
    const noFuture = structuredClone(c);
    noFuture.events = [];
    expect((await generateNonprofit(book.svc, request, noFuture)).statement.rows).toEqual(
      statement.rows,
    );
  } finally {
    await book.close();
  }
});
it('w_bb_proc 同日先解除后按新条款重新设限，先前解除不被未来凭证的新条款阻止', async () => {
  const book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  try {
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require('1002')).id,
      balance: 100,
    });
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require('3102')).id,
      balance: -100,
    });
    const vouchers = await seedVouchers(book.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '3102', debit: 100 },
          { account: '3101', credit: 100 },
        ],
      },
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '3101', debit: 100 },
          { account: '3102', credit: 100 },
        ],
      },
    ]);
    const c = blankConfiguration(book.info.id);
    c.resources[0]!.openingBalance = 0;
    c.resources[1]!.openingBalance = 100;
    const s = await readNonprofitSources(book.svc, annual);
    const make = (i: number): Configuration['events'][number] => ({
      id: `合成同日事件${i}`,
      kind: i === 0 ? 'release' : 'restriction',
      date: '2026-02-10',
      resourceId: 'R',
      amount: 100,
      sourceReference: i === 0 ? '合成原提供者解除文件' : '合成后发生新限制文件',
      lines: s.entries
        .filter((e) => e.voucherId === vouchers[i]!.id)
        .map((e) => ({ line: lineIdentity(e), debit: e.debit, credit: e.credit })),
      restriction:
        i === 0
          ? {
              ...c.resources[1]!.restriction!,
              purpose: { description: '合成教学项目', releaseReference: '合成原提供者解除文件' },
            }
          : {
              authority: 'lawOrRegulation',
              issuer: '合成法规主体',
              sourceReference: '合成后发生新限制文件',
              resourceReference: 'R',
              specificClause: '解除之后新增的外部限制',
              purpose: { description: '合成新的限定用途' },
            },
    });
    c.events = [make(0), make(1)];
    const { statement } = await generateNonprofit(book.svc, { ...annual, code: '402' }, c);
    expect(statement.rows.find((r) => r.id === 'release')!.values).toEqual([
      100, -100, 0, 100, -100, 0,
    ]);
    expect(statement.rows.find((r) => r.id === 'restriction')!.values).toEqual([
      -100, 100, 0, -100, 100, 0,
    ]);
    expect(statement.rows.find((r) => r.id === 'netChange')!.values).toEqual([0, 0, 0, 0, 0, 0]);
  } finally {
    await book.close();
  }
});
