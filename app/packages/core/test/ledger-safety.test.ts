import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { qtyFromE6 } from '../src';

let t: TestBook;
beforeEach(async () => {
  t = await createTestBook();
});
afterEach(async () => {
  await t.close();
});

const N = Number.MAX_SAFE_INTEGER;

describe('账簿精确累计', () => {
  it('真实 SQLite：借 N、借 2、贷 N，未年结的次年历史期初应为 2', async () => {
    for (const [debit, credit] of [
      [N, 0],
      [2, 0],
      [0, N],
    ]) {
      await seedVouchers(t.svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '1001', debit, credit },
            { account: '4001', debit: credit, credit: debit },
          ],
        },
      ]);
    }
    await t.svc.periods.ensureYear(2027);
    const rows = await t.svc.ledger.balances({ periodFrom: 202701, periodTo: 202701 });
    expect(rows.find((r) => r.accountCode === '1001')).toMatchObject({
      opening: 2,
      closing: 2,
      ytdDebit: 0,
      ytdCredit: 0,
    });
    expect(rows.find((r) => r.accountCode === '4001')).toMatchObject({ opening: -2, closing: -2 });
  });

  it('安全上限本身可查询；同年发生、YTD 和跨年期初最终越界均拒绝', async () => {
    const cash = await t.svc.accounts.require('1001');
    await seedVouchers(t.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: N },
          { account: '4001', credit: N },
        ],
      },
    ]);
    expect(
      (await t.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).find(
        (r) => r.accountId === cash.id,
      ),
    ).toMatchObject({ debit: N, closing: N, ytdDebit: N });
    await seedVouchers(t.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 2 },
          { account: '4001', credit: 2 },
        ],
      },
    ]);
    await t.svc.periods.ensureYear(2027);
    for (const period of [202601, 202602, 202701]) {
      await expect(
        t.svc.ledger.balances({ periodFrom: period, periodTo: period }),
      ).rejects.toMatchObject({
        data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
      });
    }
  });

  it.each(['balance', 'ytdDebit', 'ytdCredit', 'fcBalance', 'quantity'] as const)(
    '期初 %s 的 SQL 累计越界时明确拒绝',
    async (field) => {
      const account = await t.svc.accounts.create(
        {
          code: '160101',
          name: '极值账户',
          currency: 'USD',
          quantityUnit: '件',
          dimensions: [{ type: 'department' }],
        },
        [4, 2, 2],
      );
      const departments = await t.svc.dimensions.items('department');
      for (const [i, value] of [N, 2].entries()) {
        await t.svc.opening.upsert({
          year: 2026,
          accountId: account.id,
          currency: 'USD',
          dimensions: { department: departments[i]!.id },
          balance: 1,
          [field]: field === 'quantity' ? qtyFromE6(value) : value,
        });
      }
      await expect(
        t.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          currency: 'USD',
          accountCodes: ['1601'],
        }),
      ).rejects.toMatchObject({ data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' } });
    },
  );

  it('期初金额、外币和数量在 SQL 内抵销超过 Number 上限的中间和仍精确', async () => {
    const account = await t.svc.accounts.create(
      {
        code: '160101',
        name: '极值账户',
        currency: 'USD',
        quantityUnit: '件',
        dimensions: [{ type: 'department' }],
      },
      [4, 2, 2],
    );
    await t.svc.dimensions.create({ type: 'department', code: '03', name: '第三部门' });
    const departments = await t.svc.dimensions.items('department');
    for (const [i, value] of [N, 2, -N].entries()) {
      await t.svc.opening.upsert({
        year: 2026,
        accountId: account.id,
        currency: 'USD',
        dimensions: { department: departments[i]!.id },
        balance: value,
        fcBalance: value,
        quantity: qtyFromE6(value),
      });
    }
    const rows = await t.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      currency: 'USD',
      accountCodes: ['1601'],
    });
    expect(rows).toHaveLength(2);
    for (const r of rows)
      expect(r).toMatchObject({ opening: 2, fcOpening: 2, qtyOpening: '0.000002' });
  });

  it('父级跨子科目抵销精确；父级结果越界时拒绝，末级查询仍可用', async () => {
    const accounts = [];
    for (const [i, value] of [N, 2, -N].entries()) {
      const account = await t.svc.accounts.create(
        { code: `16010${i + 1}`, name: '极值账户' },
        [4, 2, 2],
      );
      accounts.push(account);
      await t.svc.opening.upsert({ year: 2026, accountId: account.id, balance: value });
    }
    const query = { periodFrom: 202601, periodTo: 202601 };
    expect(
      (await t.svc.ledger.balances(query)).find((r) => r.accountCode === '1601'),
    ).toMatchObject({ opening: 2, closing: 2 });
    await t.svc.opening.upsert({ year: 2026, accountId: accounts[2]!.id, balance: 0 });
    await expect(t.svc.ledger.balances(query)).rejects.toMatchObject({
      data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
    });
    expect(await t.svc.ledger.balances({ ...query, rollup: false })).toHaveLength(2);
  });

  it.each(['外币', '数量'] as const)(
    '%s历史期初跨年抵销保持精确，期间累计越界则拒绝',
    async (kind) => {
      for (const [i, value] of [N, 2, N].entries()) {
        await seedVouchers(t.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              {
                account: kind === '外币' ? '100202' : '1403',
                debit: i < 2 ? 1 : 0,
                credit: i === 2 ? 1 : 0,
                ...(kind === '外币'
                  ? { currency: 'USD', rate: '1', fcAmount: value }
                  : { quantity: qtyFromE6(value) }),
              },
              { account: '4001', debit: i === 2 ? 1 : 0, credit: i < 2 ? 1 : 0 },
            ],
          },
        ]);
      }
      const query = {
        periodFrom: 202601,
        periodTo: 202601,
        currency: kind === '外币' ? 'USD' : undefined,
      };
      await expect(t.svc.ledger.balances(query)).rejects.toMatchObject({
        data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
      });
      await t.svc.periods.ensureYear(2027);
      const rows = await t.svc.ledger.balances({ ...query, periodFrom: 202701, periodTo: 202701 });
      expect(
        rows.find((r) => r.accountCode === (kind === '外币' ? '100202' : '1403')),
      ).toMatchObject(
        kind === '外币'
          ? { fcOpening: 2, fcClosing: 2 }
          : { qtyOpening: '0.000002', qtyClosing: '0.000002' },
      );
    },
  );

  it('期末计算在 Number 范围外的中间和经抵销仍正确，最终越界则拒绝', async () => {
    const cash = await t.svc.accounts.require('1001');
    await t.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: N });
    for (const [debit, credit] of [
      [2, 0],
      [0, N],
    ]) {
      await seedVouchers(t.svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '1001', debit, credit },
            { account: '4001', debit: credit, credit: debit },
          ],
        },
      ]);
    }
    const query = { periodFrom: 202601, periodTo: 202601, accountCodes: ['1001'] };
    expect((await t.svc.ledger.balances(query))[0]).toMatchObject({
      opening: N,
      debit: 2,
      credit: N,
      closing: 2,
    });
    await t.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: -N });
    await expect(t.svc.ledger.balances(query)).rejects.toMatchObject({
      data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
    });
  });

  it('各一级科目安全仍须检查试算总额的安全范围', async () => {
    for (const [code, balance] of [
      ['1001', N],
      ['100201', 2],
      ['4001', -N],
      ['2001', -2],
    ] as const) {
      await t.svc.opening.upsert({
        year: 2026,
        accountId: (await t.svc.accounts.require(code)).id,
        balance,
      });
    }
    await expect(t.svc.ledger.trialBalance(202601, 202601)).rejects.toMatchObject({
      data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' },
    });
  });

  it('真实 SQLite SUM 超过 64 位时返回明确的业务错误', async () => {
    await t.svc.accounts.create(
      {
        code: '160101',
        name: '多辅助极值账户',
        dimensions: [{ type: 'department' }, { type: 'project' }],
      },
      [4, 2, 2],
    );
    const account = await t.svc.accounts.require('160101');
    const projects = [];
    const departments = [];
    for (let i = 0; i < 33; i++) {
      projects.push(
        (await t.svc.dimensions.create({ type: 'project', code: `X${i}`, name: `测试项目${i}` }))
          .id,
      );
      departments.push(
        (await t.svc.dimensions.create({ type: 'department', code: `D${i}`, name: `测试部门${i}` }))
          .id,
      );
    }
    await t.svc.tx(async (svc) => {
      for (const project of projects)
        for (const department of departments) {
          await svc.opening.upsert({
            year: 2026,
            accountId: account.id,
            dimensions: { project, department },
            balance: N,
          });
        }
    });
    await expect(
      t.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 }),
    ).rejects.toMatchObject({ data: { code: 'LEDGER_AGGREGATE_OUT_OF_RANGE' } });
  });
});
