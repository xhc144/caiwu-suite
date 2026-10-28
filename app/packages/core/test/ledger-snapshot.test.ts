import { afterEach, beforeEach, expect, it } from 'vitest';
import type { KyselyPlugin } from 'kysely';
import { openDatabase } from '@caiwu/db';
import { createTestBook, seedVouchers, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';
import { createCoreServices, type CoreDB } from '../src/server';

let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
});
afterEach(async () => book?.close());
const annual = { periodFrom: 202601, periodTo: 202612, accountCodes: ['1001'], rollup: false };

/** 观察真实SQLite聚合并可暂停首个查询的结果返回；不改SQL、行或金额。 */
function observeSums(pauseFirst = false) {
  const paused = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const targets = new Set<object>();
  let count = 0,
    stopped = false;
  const plugin: KyselyPlugin = {
    transformQuery({ node, queryId }) {
      const text = JSON.stringify(node);
      if (text.includes('"name":"voucher_line"') && text.includes('"name":"fc_debit"')) {
        count++;
        targets.add(queryId);
      }
      return node;
    },
    async transformResult({ queryId, result }) {
      if (pauseFirst && targets.has(queryId) && !stopped) {
        stopped = true;
        paused.resolve();
        await resume.promise;
      }
      return result;
    },
  };
  return { plugin, count: () => count, paused: paused.promise, resume: () => resume.resolve() };
}
async function add(date: string, amount: number, closingKind?: string) {
  const input = await voucherInputFromSpec(book.svc, {
    date,
    lines: [
      { account: '1001', debit: amount },
      { account: '4001', credit: amount },
    ],
  });
  const voucher = await book.svc.vouchers.create({ ...input, closingKind });
  await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
}
async function closingFixture() {
  await add('2026-01-05', 100);
  await add('2026-01-31', 30, 'pnl');
  await add('2026-02-05', 7);
  await add('2026-02-28', 40, 'exchange');
}

it('w_zw_ye：直接核心调用的期初、发生与YTD读取同一真实SQLite快照', async () => {
  await add('2026-01-05', 50);
  await add('2026-02-05', 20);
  const [pending] = await seedVouchers(book.svc, [
    {
      date: '2026-01-10',
      status: 'audited',
      lines: [
        { account: '1001', debit: 30 },
        { account: '4001', credit: 30 },
      ],
    },
  ]);
  const writer = openDatabase<CoreDB>(book.book.file);
  const writerSvc = createCoreServices({ ...book.svc.ctx, db: writer.db });
  const gate = observeSums(true);
  const reader = createCoreServices({ ...book.svc.ctx, db: book.book.db.withPlugin(gate.plugin) });
  const query = { ...annual, periodFrom: 202602, periodTo: 202602 };
  const reading = reader.ledger.balances(query);
  try {
    await Promise.race([
      gate.paused,
      reading.then(() => {
        throw new Error('真实聚合门控未命中');
      }),
    ]);
    expect(book.book.raw.inTransaction).toBe(true);
    await writerSvc.vouchers.changeStatus({ ids: [pending!.id], to: 'posted' });
    expect(writer.raw.inTransaction).toBe(false);
    expect((await writerSvc.ledger.balances(query))[0]).toMatchObject({
      opening: 80,
      debit: 20,
      closing: 100,
      ytdDebit: 100,
    });
    gate.resume();
    expect((await reading)[0]).toMatchObject({ opening: 50, debit: 20, closing: 70, ytdDebit: 70 });
    expect(book.book.raw.inTransaction).toBe(false);
    expect((await reader.ledger.balances(query))[0]).toMatchObject({
      opening: 80,
      debit: 20,
      closing: 100,
      ytdDebit: 100,
    });
  } finally {
    gate.resume();
    await reading.catch(() => undefined);
    await writer.close();
  }
});

it('w_zw_ye：年度同范围实际只聚合一次，未启用结转排除的参数保持同一口径', async () => {
  await closingFixture();
  for (const filter of [{}, { excludeClosing: false, excludeClosingKinds: [] }]) {
    const observer = observeSums();
    const svc = createCoreServices({
      ...book.svc.ctx,
      db: book.book.db.withPlugin(observer.plugin),
    });
    expect((await svc.ledger.balances({ ...annual, ...filter }))[0]).toMatchObject({
      opening: 0,
      debit: 177,
      closing: 177,
      ytdDebit: 177,
    });
    expect(observer.count()).toBe(1);
  }
});

it('w_zw_ye/w_hdjz：排除不同结转种类只改变发生及YTD，账面余额与历史期初保持真实', async () => {
  await closingFixture();
  for (const [filter, turnover] of [
    [{ excludeClosingKinds: ['pnl'] }, 147],
    [{ excludeClosingKinds: ['exchange'] }, 137],
    [{ excludeClosing: true }, 107],
  ] as const) {
    const observer = observeSums();
    const svc = createCoreServices({
      ...book.svc.ctx,
      db: book.book.db.withPlugin(observer.plugin),
    });
    expect(
      (
        await svc.ledger.balances({
          ...annual,
          ...filter,
          excludeClosingKinds:
            'excludeClosingKinds' in filter ? [...filter.excludeClosingKinds] : [],
        })
      )[0],
    ).toMatchObject({ debit: turnover, closing: 177, ytdDebit: turnover });
    expect(observer.count()).toBe(2);
  }
  expect(
    (
      await book.svc.ledger.balances({
        ...annual,
        periodFrom: 202602,
        periodTo: 202602,
        excludeClosingKinds: ['pnl'],
      })
    )[0],
  ).toMatchObject({ opening: 130, debit: 47, closing: 177, ytdDebit: 147 });
  expect(
    (
      await book.svc.ledger.balances({
        ...annual,
        periodFrom: 202602,
        periodTo: 202602,
        excludeClosing: true,
      })
    )[0],
  ).toMatchObject({ opening: 130, debit: 7, closing: 177, ytdDebit: 107 });
});

it('w_zw_ye：不同期间不混用，后续真实保存与过账后重新查询不会取得陈旧聚合', async () => {
  await closingFixture();
  expect((await book.svc.ledger.balances(annual))[0]).toMatchObject({
    debit: 177,
    closing: 177,
    ytdDebit: 177,
  });
  expect((await book.svc.ledger.balances({ ...annual, periodTo: 202601 }))[0]).toMatchObject({
    debit: 130,
    closing: 130,
    ytdDebit: 130,
  });
  await add('2026-03-05', 11);
  expect((await book.svc.ledger.balances(annual))[0]).toMatchObject({
    debit: 188,
    closing: 188,
    ytdDebit: 188,
  });
  expect(
    (
      await book.svc.tx((svc) =>
        svc.ledger.balances({ ...annual, periodFrom: 202602, periodTo: 202603 }),
      )
    )[0],
  ).toMatchObject({ opening: 130, debit: 58, closing: 188, ytdDebit: 188 });
  expect((await book.svc.ledger.balances({ ...annual, excludeClosing: true }))[0]).toMatchObject({
    debit: 118,
    closing: 188,
    ytdDebit: 118,
  });
});
