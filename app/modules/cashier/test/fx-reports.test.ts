import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { convertCurrency, periodStartDate } from '@caiwu/core';
import cashierServer from '../server';
import { reportsService } from '../server/reports';
import type { CashierTables } from '../server/migrations';

let app: TestApp;
let usdId: number;
let baseId: number;
let oppositeId: number;
let cashflow: number;
let additionalDependency = false;

// 真实宿主会把本模块已结月份接到统一期间检查，单独注册模块时也复现该契约。
const withPeriodDependencies: typeof cashierServer = {
  ...cashierServer,
  providers: {
    periodDependencies: [
      async (ctx, input) => {
        if (input.mode !== 'business' || ctx.moduleId !== 'cashier') return [];
        const closed = await ctx.db
          .withTables<CashierTables>()
          .selectFrom('cashier_period')
          .select('period')
          .where('period', '=', input.period)
          .where('closed', '=', 1)
          .execute();
        return [
          { category: '出纳已结账月份', count: closed.length, to: '/m/cashier' },
          { category: '合成其他期间依赖', count: additionalDependency ? 1 : 0 },
        ];
      },
    ],
  },
};

beforeEach(async () => {
  additionalDependency = false;
  app = await createTestApp({ modules: [withPeriodDependencies] });
  const a = app.call(cashierServer);
  await a.enable({ period: 202601 });
  usdId = (
    await a.saveAccount({
      data: {
        name: '美元出纳',
        coreAccountId: (await app.svc.accounts.require('100202')).id,
        currency: 'USD',
        opening: 71000,
        foreignOpening: 10000,
      },
    })
  ).id;
  baseId = (
    await a.saveAccount({
      data: {
        name: '人民币出纳',
        coreAccountId: (await app.svc.accounts.require('100201')).id,
        currency: 'CNY',
        opening: 50000,
      },
    })
  ).id;
  oppositeId = (await app.svc.accounts.require('6603')).id;
  cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
});
afterEach(async () => app.close());

const caller = () => app.call(cashierServer);
const db = () => app.svc.db.withTables<CashierTables>();
const summary = (from = 202601, to = from, includeUnclosed = true) =>
  reportsService(app.svcFor('cashier')).summary({ from, to, includeUnclosed });
async function foreign(
  amount: number,
  direction: 'receipt' | 'payment' = 'receipt',
  period = 202601,
  rate = '7.1',
) {
  return caller().createDocument({
    requestKey: randomUUID(),
    accountId: usdId,
    date: periodStartDate(period),
    period,
    summary: '外币收付',
    direction,
    amount: convertCurrency(amount, rate),
    foreignAmount: amount,
    exchangeRate: rate,
    oppositeAccountId: oppositeId,
    dimensions: { cashflow },
  });
}
async function close() {
  const p = await caller().periods();
  return caller().closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
}
async function reopen() {
  const p = await caller().periods();
  return caller().reopenPeriod({ period: p.lastClosed!, snapshot: p.snapshot, confirmed: true });
}

describe('w_cn_hz/w_cn_wbhz 本位币与原币汇总余额表', () => {
  it('同币种账户的原币合并，本位币账户不会进入美元原币合计', async () => {
    const second = await app.svc.accounts.create(
      { code: '100203', name: '美元二户', currency: 'USD', isBank: true },
      [4, 2, 2],
    );
    await caller().saveAccount({
      data: {
        name: '第二美元账户',
        coreAccountId: second.id,
        currency: 'USD',
        opening: 14200,
        foreignOpening: 2000,
      },
    });
    await foreign(2000);
    await foreign(500, 'payment');
    const result = await summary();
    expect(result.currencyTotals.find((r) => r.currency === 'USD')).toMatchObject({
      opening: 85200,
      receipt: 14200,
      payment: 3550,
      closing: 95850,
      foreignOpening: 12000,
      foreignReceipt: 2000,
      foreignPayment: 500,
      foreignClosing: 13500,
    });
  });
  it('逐账户和币种分别计算，原币不跨币种合计；本位币可汇总', async () => {
    await foreign(2000);
    await foreign(500, 'payment');
    await caller().createDocument({
      requestKey: randomUUID(),
      accountId: baseId,
      date: '2026-01-05',
      period: 202601,
      summary: '人民币收款',
      direction: 'receipt',
      amount: 1000,
      oppositeAccountId: oppositeId,
      dimensions: { cashflow },
    });
    const result = await summary();
    expect(result.rows.find((r) => r.accountId === usdId)).toMatchObject({
      opening: 71000,
      receipt: 14200,
      payment: 3550,
      closing: 81650,
      ytdReceipt: 14200,
      ytdPayment: 3550,
      foreignOpening: 10000,
      foreignReceipt: 2000,
      foreignPayment: 500,
      foreignClosing: 11500,
      foreignYtdReceipt: 2000,
      foreignYtdPayment: 500,
    });
    expect(result.rows.find((r) => r.accountId === baseId)).toMatchObject({
      opening: 50000,
      receipt: 1000,
      closing: 51000,
      foreignOpening: null,
      foreignClosing: null,
    });
    expect(result.baseTotal).toEqual({
      opening: 121000,
      receipt: 15200,
      payment: 3550,
      closing: 132650,
      ytdReceipt: 15200,
      ytdPayment: 3550,
    });
    expect(result.currencyTotals.map((r) => [r.currency, r.foreignClosing])).toEqual([
      ['CNY', null],
      ['USD', 11500],
    ]);
  });
  it('查询二月承接一月余额，本年累计和未结账开关采用相同范围', async () => {
    await foreign(2000);
    await foreign(500, 'payment');
    await foreign(1000, 'receipt', 202602, '7.2');
    const feb = (await summary(202602)).rows.find((r) => r.accountId === usdId)!;
    expect(feb).toMatchObject({
      opening: 81650,
      receipt: 7200,
      payment: 0,
      closing: 88850,
      foreignOpening: 11500,
      foreignReceipt: 1000,
      foreignClosing: 12500,
      ytdReceipt: 21400,
      ytdPayment: 3550,
      foreignYtdReceipt: 3000,
      foreignYtdPayment: 500,
    });
    await close();
    const closed = await summary(202601, 202602, false);
    expect(closed.effectiveTo).toBe(202601);
    expect(closed.excludedPeriods).toEqual([202602]);
    expect(closed.rows.find((r) => r.accountId === usdId)).toMatchObject({
      receipt: 14200,
      payment: 3550,
      closing: 81650,
      foreignClosing: 11500,
      ytdReceipt: 14200,
      foreignYtdReceipt: 2000,
    });
    const none = await summary(202602, 202602, false);
    expect(none.effectiveTo).toBeNull();
    expect(none.rows.find((r) => r.accountId === usdId)).toMatchObject({
      opening: 81650,
      closing: 81650,
      receipt: 0,
      payment: 0,
      foreignOpening: 11500,
      foreignClosing: 11500,
      foreignReceipt: 0,
      foreignPayment: 0,
    });
  });
  it('拒绝起止倒置、跨年、启用前和未建立年度，不把缺少的外币当作零', async () => {
    await expect(summary(202602, 202601)).rejects.toThrow('同一年度');
    await expect(summary(202601, 202701)).rejects.toThrow('同一年度');
    await expect(summary(202512)).rejects.toThrow('早于');
    await expect(summary(202701)).rejects.toThrow('尚未建立');
    await db()
      .updateTable('cashier_opening')
      .set({ foreign_balance: null })
      .where('account_id', '=', usdId)
      .execute();
    await expect(summary()).rejects.toThrow('缺少原币');
    await expect(caller().periods()).rejects.toThrow('缺少原币');
  });
  it('本位币汇总触及安全整数边界时拒绝，不返回失真的总额', async () => {
    await db()
      .updateTable('cashier_opening')
      .set({ balance: Number.MAX_SAFE_INTEGER })
      .where('account_id', '=', baseId)
      .execute();
    await expect(summary()).rejects.toThrow('安全整数');
  });
});

describe('w_cn_fz/w_cn_fjz 外币月结和年初承接', () => {
  it('宿主登记的已结月份依赖不阻止合法反结账，其他依赖仍拒绝并回滚', async () => {
    await foreign(2000);
    await close();
    const snapshot = await db().selectFrom('cashier_month_balance').selectAll().execute();
    additionalDependency = true;
    await expect(reopen()).rejects.toThrow('合成其他期间依赖');
    expect((await caller().periods()).current).toBe(202602);
    expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toEqual(snapshot);
    additionalDependency = false;
    await reopen();
    expect((await caller().periods()).current).toBe(202601);
    expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toEqual([]);
  });
  it('总账月份关闭时拒绝结账和反结账，保留既有出纳余额快照', async () => {
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(close()).rejects.toThrow('已经结账');
    expect((await caller().periods()).current).toBe(202601);
    await app.svc.periods.setStatus(202601, 'open');
    await close();
    const snapshot = await db().selectFrom('cashier_month_balance').selectAll().execute();
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(reopen()).rejects.toThrow('已经结账');
    expect((await caller().periods()).current).toBe(202602);
    expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toEqual(snapshot);
  });
  it('月结保存本币和原币四列，十二月承接下一年，反结账只删除衍生数据', async () => {
    await foreign(2000);
    await foreign(500, 'payment');
    const before = await caller().documents({});
    expect((await caller().periods()).rows.find((r) => r.accountId === usdId)).toMatchObject({
      foreignOpening: 10000,
      foreignReceipt: 2000,
      foreignPayment: 500,
      foreignClosing: 11500,
    });
    await close();
    expect(
      await db()
        .selectFrom('cashier_month_balance')
        .selectAll()
        .where('account_id', '=', usdId)
        .executeTakeFirst(),
    ).toMatchObject({
      period: 202601,
      opening: 71000,
      receipt: 14200,
      payment: 3550,
      closing: 81650,
      foreign_opening: 10000,
      foreign_receipt: 2000,
      foreign_payment: 500,
      foreign_closing: 11500,
    });
    await app.svc.periods.ensureYear(2027);
    for (let i = 0; i < 11; i++) await close();
    expect((await caller().accounts({ year: 2027 })).find((r) => r.id === usdId)).toMatchObject({
      opening: 81650,
      foreignOpening: 11500,
    });
    expect((await summary(202701)).rows.find((r) => r.accountId === usdId)).toMatchObject({
      opening: 81650,
      foreignOpening: 11500,
      closing: 81650,
      foreignClosing: 11500,
      ytdReceipt: 0,
      foreignYtdReceipt: 0,
    });
    await reopen();
    expect(
      await db().selectFrom('cashier_opening').selectAll().where('period', '=', 202701).execute(),
    ).toEqual([]);
    expect(await caller().documents({})).toEqual(before);
    await close();
    expect(
      (await caller().accounts({ year: 2027 })).find((r) => r.id === usdId)?.foreignOpening,
    ).toBe(11500);
  });
  it('月结和反结账写日志失败时，原币快照及期间状态一起回滚', async () => {
    await foreign(2000);
    await sql`CREATE TRIGGER cashier_fx_close_failure BEFORE INSERT ON operation_log WHEN NEW.action = 'cashier.period.close' BEGIN SELECT RAISE(FAIL, '合成外币结账失败'); END`.execute(
      app.svc.db,
    );
    await expect(close()).rejects.toThrow('合成外币结账失败');
    expect(await db().selectFrom('cashier_month_balance').selectAll().execute()).toEqual([]);
    expect((await caller().periods()).current).toBe(202601);
    await sql`DROP TRIGGER cashier_fx_close_failure`.execute(app.svc.db);
    await close();
    await sql`CREATE TRIGGER cashier_fx_reopen_failure BEFORE INSERT ON operation_log WHEN NEW.action = 'cashier.period.reopen' BEGIN SELECT RAISE(FAIL, '合成外币反结账失败'); END`.execute(
      app.svc.db,
    );
    await expect(reopen()).rejects.toThrow('合成外币反结账失败');
    expect((await caller().periods()).current).toBe(202602);
    expect(
      await db()
        .selectFrom('cashier_month_balance')
        .select('foreign_closing')
        .where('account_id', '=', usdId)
        .executeTakeFirst(),
    ).toEqual({ foreign_closing: 12000 });
  });
  it('fast-check 原币月初加收款减付款等于月末，反结账保持原单不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: -100, max: 100 }).filter((v) => v !== 0),
          { minLength: 1, maxLength: 6 },
        ),
        async (values) => {
          for (const value of values)
            await foreign(Math.abs(value) * 10, value > 0 ? 'receipt' : 'payment');
          const docs = await caller().documents({ accountId: usdId });
          const p = await caller().periods();
          const row = p.rows.find((r) => r.accountId === usdId)!;
          expect(row.foreignClosing).toBe(
            10000 + docs.reduce((n, d) => n + (d.foreignSigned ?? 0), 0),
          );
          await close();
          await reopen();
          expect((await caller().periods()).rows).toEqual(p.rows);
          expect(await caller().documents({ accountId: usdId })).toEqual(docs);
        },
      ),
      { numRuns: 10 },
    );
  });
});
