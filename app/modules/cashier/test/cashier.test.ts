import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { BusinessError, Voucher } from '@caiwu/core';
import type { TRPCError } from '@trpc/server';
import type { DocumentInput, GenerateInput } from '../shared';
import { safeSum, signedAmount, matchSuggestions } from '../shared';
import type { CashierTables } from '../server/migrations';
import cashierServer from '../server';

let app: TestApp;
const call = (a: TestApp, token?: string) => a.call(cashierServer, token);
let api: ReturnType<typeof call>;
let accountId: number;
let bankId: number;
let oppositeId: number;
let cashflow: number;
let typeId: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
  api = call(app);
  bankId = (await app.svc.accounts.require('100201')).id;
  oppositeId = (await app.svc.accounts.require('6603')).id;
  cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  typeId = (await app.svc.reference.voucherTypes())[0]!.id;
  await api.enable({ period: 202601 });
  accountId = (
    await api.saveAccount({
      data: { name: '工商银行', coreAccountId: bankId, currency: 'CNY', opening: 100000 },
    })
  ).id;
  await app.svc.opening.upsert({ year: 2026, accountId: bankId, balance: 100000 });
});
afterEach(async () => app.close());
const base = (overrides: Partial<DocumentInput> = {}): DocumentInput => ({
  accountId,
  period: 202601,
  date: '2026-01-10',
  summary: '银行收付',
  direction: 'receipt',
  amount: 12345,
  oppositeAccountId: oppositeId,
  dimensions: { cashflow },
  ...overrides,
});
const create = (overrides: Partial<DocumentInput> = {}) =>
  api.createDocument({ ...base(overrides), requestKey: randomUUID() });
const all = () => api.documents({});
async function selection() {
  return (await all()).map((r) => ({ id: r.id, revision: r.revision }));
}
async function generation(mode: 'individual' | 'summary' = 'individual'): Promise<GenerateInput> {
  return { documents: await selection(), date: '2026-01-10', voucherTypeId: typeId, mode };
}
async function posted() {
  const rows = await all();
  const ids = [...new Set(rows.map((d) => d.voucherId!))];
  await app.svc.vouchers.changeStatus({ ids, to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids, to: 'posted' });
}
const reconcile = (cutoff = '2026-01-31') => api.reconcile({ accountId, cutoff });
async function matchAll() {
  const r = await reconcile();
  return api.match({
    accountId,
    cutoff: r.cutoff,
    documents: r.documents.map((d) => ({ id: d.id, revision: d.revision })),
    lineIds: r.entries.map((e) => e.lineId),
    snapshot: r.snapshot,
    confirmed: true,
  });
}
async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (e: unknown) => e as TRPCError,
  );
  expect(e).not.toBeNull();
  return (e!.cause as BusinessError)?.data?.code ?? e!.code;
}

describe('出纳真实闭环', () => {
  it('w_cn_xtcsh 重复启用保留账户、期初、单据、凭证和勾账', async () => {
    await create();
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    await matchAll();
    const before = await reconcile();
    await api.enable({ period: 202601 });
    expect(await reconcile()).toEqual(before);
    expect(await code(api.enable({ period: 202602 }))).toBe('CASHIER_ENABLED');
  });
  it('w_cn_lr_qc_nf 启用前年份拒绝、后年无年结期初给处理提示；只读账务期初', async () => {
    expect(await code(api.accounts({ year: 2025 }))).toBe('CASHIER_OPENING_YEAR');
    expect(await code(api.accounts({ year: 2027 }))).toBe('CASHIER_OPENING_YEAR');
    expect((await api.accounts({ year: 2026 }))[0]).toMatchObject({
      opening: 100000,
      coreOpening: 100000,
    });
    await api.saveAccount({
      data: { name: '新名称', coreAccountId: bankId, currency: 'CNY', opening: 99000 },
      edit: { id: accountId, revision: 1 },
    });
    expect((await app.svc.opening.list(2026))[0]!.balance).toBe(100000);
  });
  it('w_cn_xtcsh 无启用状态拒绝保存；无效账户、重复科目、外币拒绝', async () => {
    expect(
      await code(
        api.saveAccount({
          data: { name: '非现金银行', coreAccountId: oppositeId, currency: 'CNY', opening: 0 },
        }),
      ),
    ).toBe('CASHIER_CASH_ACCOUNT');
    expect(
      await code(
        api.saveAccount({
          data: { name: '重复', coreAccountId: bankId, currency: 'CNY', opening: 0 },
        }),
      ),
    ).toBe('CASHIER_ACCOUNT_DUPLICATE');
    expect(
      await code(
        api.saveAccount({
          data: {
            name: '外币',
            coreAccountId: (await app.svc.accounts.require('100202')).id,
            currency: 'USD',
            opening: 0,
          },
        }),
      ),
    ).toBe('CASHIER_CURRENCY');
    await app.svcFor('cashier').settings.set('enabledPeriod', null);
    expect(await code(create())).toBe('CASHIER_NOT_ENABLED');
  });
  it('w_cn_lr_add 零额、不安全金额、非末级、日期超出月份和启用前日期阻止', async () => {
    expect(await code(create({ amount: 0 }))).toBe('BAD_REQUEST');
    expect(await code(create({ amount: Number.MAX_SAFE_INTEGER + 1 }))).toBe('BAD_REQUEST');
    expect(
      await code(create({ oppositeAccountId: (await app.svc.accounts.require('1002')).id })),
    ).toBe('CASHIER_ACCOUNT_LEAF');
    expect(await code(create({ date: '2026-02-01' }))).toBe('CASHIER_DATE_PERIOD');
    expect(await code(create({ date: '2025-12-31', period: 202512 }))).toBe('CASHIER_BEFORE_START');
  });
  it('w_cn_lr_add 同科目、缺现金流量、缺部门或错误维度阻止，必要辅助随凭证保存', async () => {
    expect(await code(create({ oppositeAccountId: bankId }))).toBe('CASHIER_SAME_ACCOUNT');
    expect(await code(create({ dimensions: {} }))).toBe('CASHIER_DIMENSION');
    const management = (await app.svc.accounts.require('6602')).id;
    expect(await code(create({ oppositeAccountId: management }))).toBe('CASHIER_DIMENSION');
    expect(await code(create({ dimensions: { cashflow: 99999 } }))).toBe('CASHIER_DIMENSION');
    const department = (await app.svc.dimensions.getByCode('department', '01'))!.id;
    await create({ oppositeAccountId: management, dimensions: { cashflow, department } });
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    const v = await app.svc.vouchers.get((await all())[0]!.voucherId!);
    expect(v!.lines[1]!.dimensions.department).toBe(department);
    expect(v!.lines[0]!.dimensions.department).toBeNull();
  });
  it('w_cn_lr core期间已关闭与出纳月已关闭分别阻止新增及改删', async () => {
    const d = await create();
    await app.svc.periods.setStatus(202601, 'closed');
    expect(await code(create())).toBe('PERIOD_CLOSED');
    expect(await code(api.updateDocument({ id: d.id, revision: 1, data: base() }))).toBe(
      'PERIOD_CLOSED',
    );
    expect(await code(api.removeDocument({ id: d.id, revision: 1, confirmed: true }))).toBe(
      'PERIOD_CLOSED',
    );
    await app.svc.periods.setStatus(202601, 'open');
    await app.svc.db
      .withTables<CashierTables>()
      .insertInto('cashier_period')
      .values({ period: 202601, closed: 1 })
      .execute();
    expect(await code(create())).toBe('CASHIER_PERIOD_CLOSED');
    expect(await code(api.removeDocument({ id: d.id, revision: 1, confirmed: true }))).toBe(
      'CASHIER_PERIOD_CLOSED',
    );
  });
  it('w_cn_lr 单号不可修改、请求幂等、过期版本阻止、用过账户及已结历史期初不可变', async () => {
    const input = { ...base(), requestKey: randomUUID() };
    const d = await api.createDocument(input);
    expect(await api.createDocument(input)).toEqual(d);
    expect(await code(api.createDocument({ ...input, amount: 1 }))).toBe('CASHIER_IDEMPOTENCY');
    await api.updateDocument({ id: d.id, revision: 1, data: base({ summary: '更新' }) });
    expect(await code(api.updateDocument({ id: d.id, revision: 1, data: base() }))).toBe(
      'CASHIER_STALE',
    );
    expect((await all())[0]!.number).toBe('CN-000001');
    await api.removeDocument({ id: d.id, revision: 2, confirmed: true });
    expect(await code(api.createDocument(input))).toBe('CASHIER_DOCUMENT_REMOVED');
    expect(
      await code(
        api.saveAccount({
          edit: { id: accountId, revision: 1 },
          data: { name: '银行', coreAccountId: bankId, currency: 'CNY', opening: 1 },
        }),
      ),
    ).toBe('CASHIER_OPENING_LOCKED');
  });
  it('w_cn_lr 账户停用保留历史并拒新增，版本防止覆盖', async () => {
    await create();
    await api.setDisabled({ id: accountId, revision: 1, disabled: true });
    expect((await all()).length).toBe(1);
    expect(await code(create())).toBe('CASHIER_DISABLED');
    expect(await code(api.setDisabled({ id: accountId, revision: 1, disabled: false }))).toBe(
      'CASHIER_STALE',
    );
  });
  it('w_cn_cx 按日期、摘要、金额、账户、生成及勾账状态过滤，错误范围不忽略', async () => {
    await create({ summary: '收款甲', amount: 1 });
    await create({ summary: '收款乙', amount: 2 });
    expect(
      (
        await api.documents({
          keyword: '甲',
          min: 1,
          max: 1,
          accountId,
          generated: 'no',
          matched: 'no',
          from: '2026-01-01',
          to: '2026-01-31',
        })
      ).length,
    ).toBe(1);
    expect(await code(api.documents({ min: 2, max: 1 }))).toBe('BAD_REQUEST');
    expect(await code(api.documents({ from: '2026-02-01', to: '2026-01-01' }))).toBe('BAD_REQUEST');
  });
  it.each(['individual', 'summary'] as const)(
    'w_cn_pz %s 3笔收付→平衡来源凭证→过账→多对多勾账→取消，余额均不变',
    async (mode) => {
      await create({ amount: 20000 });
      await create({ amount: 8000, direction: 'payment' });
      await create({ amount: 2500 });
      const request = { ...(await generation(mode)), requestKey: randomUUID() };
      const done = await api.generate(request);
      expect(await api.generate(request)).toEqual(done);
      const docs = await all();
      const ids = [...new Set(docs.map((d) => d.voucherId!))];
      expect(ids.length).toBe(mode === 'individual' ? 3 : 1);
      const vouchers: Voucher[] = [];
      for (const id of ids) vouchers.push((await app.svc.vouchers.get(id))!);
      expect(vouchers.every((v) => v.debitTotal === v.creditTotal && v.status === 'pending')).toBe(
        true,
      );
      expect(vouchers.reduce((s, v) => s + v.debitTotal, 0)).toBe(30500);
      expect(vouchers[0]!.source).toEqual({
        module: 'cashier',
        type: 'batch',
        id: String(done.batchId),
      });
      expect((await reconcile()).entries).toHaveLength(0);
      await posted();
      const before = await reconcile();
      expect(before.adjustment).toMatchObject({
        cashBalance: 114500,
        coreBalance: 114500,
        cashOutstanding: 14500,
        coreOutstanding: 14500,
        difference: 0,
      });
      const group = await matchAll();
      const matched = await reconcile();
      expect(matched.adjustment).toMatchObject({
        cashBalance: 114500,
        coreBalance: 114500,
        cashOutstanding: 0,
        coreOutstanding: 0,
        difference: 0,
      });
      expect(matched.groups[0]?.valid).toBe(true);
      expect(
        await code(
          api.removeDocument({ id: docs[0]!.id, revision: docs[0]!.revision, confirmed: true }),
        ),
      ).toBe('CASHIER_MATCHED');
      expect(await code(api.revoke({ batchId: done.batchId, confirmed: true }))).toBe(
        'CASHIER_MATCHED',
      );
      await api.unmatch({ id: group.id, confirmed: true });
      expect((await reconcile()).adjustment).toEqual(before.adjustment);
      expect(await code(api.unmatch({ id: group.id, confirmed: true }))).toBe(
        'CASHIER_MATCH_NOT_FOUND',
      );
    },
  );
  it('w_cn_pz 来源锁定、空批次、重复生成、旧版本及缺映射阻止', async () => {
    expect(
      await code(
        api.generate({
          documents: [],
          date: '2026-01-10',
          mode: 'summary',
          voucherTypeId: typeId,
          requestKey: randomUUID(),
        }),
      ),
    ).toBe('BAD_REQUEST');
    const d = await create({ oppositeAccountId: null });
    expect(await code(api.preview(await generation()))).toBe('CASHIER_MAPPING');
    await api.updateDocument({ id: d.id, revision: 1, data: base() });
    const input = await generation();
    await api.generate({ ...input, requestKey: randomUUID() });
    const row = (await all())[0]!;
    expect(await code(api.generate({ ...input, requestKey: randomUUID() }))).toBe('CASHIER_STALE');
    expect(await code(api.updateDocument({ id: d.id, revision: row.revision, data: base() }))).toBe(
      'CASHIER_VOUCHERED',
    );
    expect(
      await code(api.removeDocument({ id: d.id, revision: row.revision, confirmed: true })),
    ).toBe('CASHIER_VOUCHERED');
    await expect(app.svc.vouchers.delete(row.voucherId!)).rejects.toThrow(/出纳/);
  });
  it('w_cn_pz 未审核批次整体撤销后能改原单；审核后拒撤销', async () => {
    const d = await create();
    const done = await api.generate({ ...(await generation()), requestKey: randomUUID() });
    const voucherId = (await all())[0]!.voucherId!;
    await api.revoke({ batchId: done.batchId, confirmed: true });
    expect(await app.svc.vouchers.get(voucherId)).toBeNull();
    let row = (await all())[0]!;
    await api.updateDocument({ id: d.id, revision: row.revision, data: base({ amount: 777 }) });
    const done2 = await api.generate({ ...(await generation()), requestKey: randomUUID() });
    row = (await all())[0]!;
    await app.svc.vouchers.changeStatus({ ids: [row.voucherId!], to: 'audited' });
    expect(await code(api.revoke({ batchId: done2.batchId, confirmed: true }))).toBe(
      'CASHIER_VOUCHER_LOCKED',
    );
    expect((await app.svc.vouchers.get(row.voucherId!))!.status).toBe('audited');
  });
  it('w_cn_pz 事务注入失败无孤儿批次、凭证、映射或部分锁单，重试成功', async () => {
    await create();
    await create({ amount: 99 });
    await sql
      .raw(
        "CREATE TRIGGER cashier_test_failure BEFORE INSERT ON cashier_batch_document BEGIN SELECT RAISE(ABORT, '注入失败'); END",
      )
      .execute(app.svc.db);
    const input = { ...(await generation()), requestKey: randomUUID() };
    await expect(api.generate(input)).rejects.toThrow(/注入失败/);
    expect(await app.svc.vouchers.list({})).toEqual({ items: [], total: 0 });
    expect(
      await app.svc.db
        .withTables<CashierTables>()
        .selectFrom('cashier_batch')
        .selectAll()
        .execute(),
    ).toEqual([]);
    expect((await all()).every((d) => d.voucherId == null && d.revision === 1)).toBe(true);
    await sql.raw('DROP TRIGGER cashier_test_failure').execute(app.svc.db);
    await api.generate(input);
    expect((await all()).every((d) => d.voucherId != null)).toBe(true);
  });
  it('w_cn_dz 差一分拒绝、过期快照拒绝、重复勾账拒绝、未过账及作废排除', async () => {
    await create({ amount: 100 });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '100201', debit: 99, dims: { cashflow: 'CF01' } },
          { account: '6603', credit: 99 },
        ],
      },
    ]);
    const s = await reconcile();
    const input = {
      accountId,
      cutoff: s.cutoff,
      documents: s.documents.map((d) => ({ id: d.id, revision: d.revision })),
      lineIds: s.entries.map((e) => e.lineId),
      snapshot: s.snapshot,
      confirmed: true as const,
    };
    expect(await code(api.match(input))).toBe('CASHIER_MATCH_AMOUNT');
    const doc = s.documents[0]!;
    await api.updateDocument({ id: doc.id, revision: doc.revision, data: base({ amount: 99 }) });
    expect(await code(api.match(input))).toBe('CASHIER_STALE');
    await matchAll();
    const current = await reconcile();
    expect(
      await code(api.match({ ...input, documents: await selection(), snapshot: current.snapshot })),
    ).toBe('CASHIER_MATCH_DUPLICATE');
    const [v] = await seedVouchers(app.svc, [
      {
        date: '2026-01-11',
        lines: [
          { account: '100201', debit: 10, dims: { cashflow: 'CF01' } },
          { account: '6603', credit: 10 },
        ],
      },
    ]);
    expect((await reconcile()).entries).toHaveLength(1);
    await app.svc.vouchers.setVoided(v!.id, true);
    expect((await reconcile()).entries).toHaveLength(1);
  });
  it('w_cn_dz 异常勾账组拒取消，原组保留，勾账写日志', async () => {
    await create();
    const b = await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const group = await matchAll();
    await app.svc.db
      .withTables<CashierTables>()
      .updateTable('cashier_match')
      .set({ amount: 1 })
      .where('id', '=', group.id)
      .execute();
    expect(await code(api.unmatch({ id: group.id, confirmed: true }))).toBe(
      'CASHIER_MATCH_ABNORMAL',
    );
    expect((await reconcile()).groups).toHaveLength(1);
    expect((await all())[0]!.batchId).toBe(b.batchId);
    expect((await app.svc.log.list()).some((l) => l.action === 'cashier.reconcile.match')).toBe(
      true,
    );
  });
  it('w_cn_dz_ye_rq 截止日后交易排除、期初不一致单列、不以补差强行平衡', async () => {
    await create({ date: '2026-01-10', amount: 100 });
    await create({ date: '2026-01-20', amount: 999 });
    await app.svc.opening.upsert({ year: 2026, accountId: bankId, balance: 100001 });
    const r = await reconcile('2026-01-15');
    expect(r.documents).toHaveLength(1);
    expect(r.adjustment).toMatchObject({
      cashBalance: 100100,
      coreBalance: 100001,
      cashOutstanding: 100,
      openingDifference: -1,
      difference: -1,
    });
    expect(await code(reconcile('2025-12-31'))).toBe('CASHIER_CUTOFF');
  });
  it('w_cn_dz 不同账户不混勾；未达项无重复并全覆盖', async () => {
    await create();
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const second = (
      await api.saveAccount({
        data: {
          name: '现金',
          coreAccountId: (await app.svc.accounts.require('1001')).id,
          currency: 'CNY',
          opening: 0,
        },
      })
    ).id;
    const r = await api.reconcile({ accountId: second, cutoff: '2026-01-31' });
    expect(r.documents).toHaveLength(0);
    expect(r.entries).toHaveLength(0);
    const first = await reconcile();
    expect(new Set(first.adjustment.cashOutstandingIds).size).toBe(first.documents.length);
    expect(new Set(first.adjustment.coreOutstandingIds).size).toBe(first.entries.length);
  });
  it('w_cn_pz/w_cn_dz 权限用户不能越权生成、勾账、启用和读敏感数据', async () => {
    await create();
    const viewer = call(app, await app.addUser('viewer', { permissions: ['cashier.view'] }));
    expect((await viewer.documents({})).length).toBe(1);
    expect(await code(viewer.generate({ ...(await generation()), requestKey: randomUUID() }))).toBe(
      'FORBIDDEN',
    );
    expect(await code(viewer.unmatch({ id: 1, confirmed: true }))).toBe('FORBIDDEN');
    expect(await code(viewer.enable({ period: 202601 }))).toBe('FORBIDDEN');
    const nobody = call(app, await app.addUser('nobody'));
    expect(await code(nobody.reconcile({ accountId, cutoff: '2026-01-31' }))).toBe('FORBIDDEN');
  });
  it('w_cn_hz 任意整数收付序列的真实持久化、凭证平衡及勾账取消不变量', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: -100000, max: 100000 }).filter((x) => x !== 0),
          { minLength: 1, maxLength: 6 },
        ),
        async (amounts) => {
          const fresh = await createTestApp({ modules: [cashierServer] });
          try {
            const a = fresh.call(cashierServer);
            const bank = (await fresh.svc.accounts.require('100201')).id;
            const opposite = (await fresh.svc.accounts.require('6603')).id;
            const cf = (await fresh.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
            await a.enable({ period: 202601 });
            const acc = await a.saveAccount({
              data: { name: '银行', coreAccountId: bank, currency: 'CNY', opening: 0 },
            });
            for (const value of amounts)
              await a.createDocument({
                accountId: acc.id,
                period: 202601,
                date: '2026-01-10',
                summary: '性质测试',
                direction: value > 0 ? 'receipt' : 'payment',
                amount: Math.abs(value),
                oppositeAccountId: opposite,
                dimensions: { cashflow: cf },
                requestKey: randomUUID(),
              });
            const docs = await a.documents({});
            await a.generate({
              documents: docs.map((d) => ({ id: d.id, revision: d.revision })),
              date: '2026-01-10',
              voucherTypeId: (await fresh.svc.reference.voucherTypes())[0]!.id,
              mode: 'summary',
              requestKey: randomUUID(),
            });
            const v = (await a.documents({}))[0]!.voucherId!;
            const voucher = (await fresh.svc.vouchers.get(v))!;
            expect(voucher.debitTotal).toBe(voucher.creditTotal);
            expect(voucher.debitTotal).toBe(amounts.reduce((s, n) => s + Math.abs(n), 0));
            await fresh.svc.vouchers.changeStatus({ ids: [v], to: 'audited' });
            await fresh.svc.vouchers.changeStatus({ ids: [v], to: 'posted' });
            const before = await a.reconcile({ accountId: acc.id, cutoff: '2026-01-31' });
            expect(before.adjustment.cashBalance).toBe(safeSum(amounts));
            expect(safeSum(docs.map(signedAmount))).toBe(safeSum(amounts));
            expect(before.adjustment.difference).toBe(0);
            const g = await a.match({
              accountId: acc.id,
              cutoff: before.cutoff,
              documents: before.documents.map((d) => ({ id: d.id, revision: d.revision })),
              lineIds: before.entries.map((e) => e.lineId),
              snapshot: before.snapshot,
              confirmed: true,
            });
            const after = await a.reconcile({ accountId: acc.id, cutoff: before.cutoff });
            expect(after.adjustment.cashBalance).toBe(before.adjustment.cashBalance);
            expect(after.adjustment.coreBalance).toBe(before.adjustment.coreBalance);
            await a.unmatch({ id: g.id, confirmed: true });
            expect(
              (await a.reconcile({ accountId: acc.id, cutoff: before.cutoff })).adjustment,
            ).toEqual(before.adjustment);
          } finally {
            await fresh.close();
          }
        },
      ),
      { numRuns: 15 },
    );
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow(/安全整数/);
  });
  it('w_cn_lr_get1 同库分录只读，不复制为出纳单或再次生成凭证', async () => {
    const [voucher] = await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '100201', debit: 100, dims: { cashflow: 'CF01' } },
          { account: '6603', credit: 100 },
        ],
      },
    ]);
    const view = await reconcile();
    expect(view.entries).toHaveLength(1);
    expect(view.documents).toHaveLength(0);
    expect(await all()).toHaveLength(0);
    expect(
      await code(api.removeDocument({ id: voucher!.lines[0]!.id, revision: 1, confirmed: true })),
    ).toBe('NOT_FOUND');
    expect((await app.svc.vouchers.list({})).total).toBe(1);
  });
  it('w_cn_pz 撤销批次中后续凭证已审核，之前删除也整体回滚', async () => {
    await create();
    await create({ amount: 2 });
    const batch = await api.generate({ ...(await generation()), requestKey: randomUUID() });
    const rows = await all();
    await app.svc.vouchers.changeStatus({ ids: [rows[1]!.voucherId!], to: 'audited' });
    expect(await code(api.revoke({ batchId: batch.batchId, confirmed: true }))).toBe(
      'CASHIER_VOUCHER_LOCKED',
    );
    expect((await app.svc.vouchers.get(rows[0]!.voucherId!))!.status).toBe('pending');
    expect(await all()).toEqual(await api.documents({ batch: batch.batchId }));
    expect((await all()).every((r) => r.batchId === batch.batchId && r.voucherId != null)).toBe(
      true,
    );
  });
  it('w_cn_pz 其他来源凭证不能通过出纳撤销', async () => {
    await create();
    const batch = await api.generate({ ...(await generation()), requestKey: randomUUID() });
    const original = (await all())[0]!.voucherId!;
    const [manual] = await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '100201', debit: 1 },
          { account: '6603', credit: 1 },
        ],
      },
    ]);
    await app.svc.db
      .withTables<CashierTables>()
      .updateTable('cashier_batch_document')
      .set({ voucher_id: manual!.id })
      .where('batch_id', '=', batch.batchId)
      .execute();
    expect(await code(api.revoke({ batchId: batch.batchId, confirmed: true }))).toBe(
      'CASHIER_SOURCE',
    );
    expect(await app.svc.vouchers.get(original)).not.toBeNull();
    expect(await app.svc.vouchers.get(manual!.id)).not.toBeNull();
  });
  it('w_cn_lr_add 保存后续表操作失败不留下半张单；账户已有账务业务后锁初值', async () => {
    await sql
      .raw(
        "CREATE TRIGGER cashier_test_document_failure BEFORE UPDATE ON cashier_account BEGIN SELECT RAISE(ABORT, '单据后续写失败'); END",
      )
      .execute(app.svc.db);
    await expect(create()).rejects.toThrow(/单据后续写失败/);
    expect(await all()).toEqual([]);
    await sql.raw('DROP TRIGGER cashier_test_document_failure').execute(app.svc.db);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '100201', debit: 1 },
          { account: '6603', credit: 1 },
        ],
      },
    ]);
    expect(
      await code(
        api.saveAccount({
          edit: { id: accountId, revision: 1 },
          data: { name: '银行', coreAccountId: bankId, currency: 'CNY', opening: 0 },
        }),
      ),
    ).toBe('CASHIER_OPENING_LOCKED');
  });
  it('w_cn_dz 已勾分录取消过账后组异常，不能抹掉原组；强确认不可省略', async () => {
    await create();
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const group = await matchAll();
    expect(await code(api.unmatch({ id: group.id, confirmed: false as true }))).toBe('BAD_REQUEST');
    const id = (await all())[0]!.voucherId!;
    await app.svc.vouchers.changeStatus({ ids: [id], to: 'audited' });
    expect(await code(api.unmatch({ id: group.id, confirmed: true }))).toBe(
      'CASHIER_MATCH_ABNORMAL',
    );
    expect((await reconcile()).groups).toHaveLength(1);
  });
});

describe('w_cn_dz 自动勾账建议与确认', () => {
  it('日期顺序的一对一等额候选，逐对真实写入且取消恢复原余额', async () => {
    await create({ amount: 101 });
    await create({ amount: 202, direction: 'payment' });
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const r = await reconcile();
    const suggestions = matchSuggestions(r.documents, r.entries);
    expect(suggestions.every((s) => s.unique)).toBe(true);
    const result = await api.autoMatch({
      accountId,
      cutoff: r.cutoff,
      snapshot: r.snapshot,
      pairs: suggestions.map((s) => ({
        documentId: s.document.id,
        revision: s.document.revision,
        lineId: s.candidates[0]!.lineId,
      })),
      confirmed: true,
    });
    expect(result.ids).toHaveLength(2);
    const after = await reconcile();
    expect(after.groups.every((g) => g.valid)).toBe(true);
    expect(after.adjustment.cashOutstanding).toBe(0);
    expect(after.adjustment.coreOutstanding).toBe(0);
    for (const id of result.ids) await api.unmatch({ id, confirmed: true });
    expect((await reconcile()).adjustment).toEqual(r.adjustment);
  });
  it('重复金额保持歧义，不默认抢占同一分录；明确候选后可以确认', async () => {
    await create({ amount: 101 });
    await create({ amount: 101, date: '2026-01-11' });
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const r = await reconcile();
    const suggestions = matchSuggestions(r.documents, r.entries);
    expect(suggestions.map((s) => [s.unique, s.candidates.length])).toEqual([
      [false, 2],
      [false, 2],
    ]);
    await expect(
      api.autoMatch({
        accountId,
        cutoff: r.cutoff,
        snapshot: r.snapshot,
        pairs: r.documents.map((d) => ({
          documentId: d.id,
          revision: d.revision,
          lineId: r.entries[0]!.lineId,
        })),
        confirmed: true,
      }),
    ).rejects.toThrow();
    expect((await reconcile()).groups).toEqual([]);
    await api.autoMatch({
      accountId,
      cutoff: r.cutoff,
      snapshot: r.snapshot,
      pairs: r.documents.map((d, i) => ({
        documentId: d.id,
        revision: d.revision,
        lineId: r.entries[i]!.lineId,
      })),
      confirmed: true,
    });
    expect((await reconcile()).groups).toHaveLength(2);
  });
  it('无候选、方向不符、过期快照、无权限及未确认都不会写入', async () => {
    await create({ amount: 101 });
    await create({ amount: 202, direction: 'payment' });
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const r = await reconcile();
    expect(matchSuggestions(r.documents, [])[0]!.candidates).toEqual([]);
    const pair = {
      documentId: r.documents[0]!.id,
      revision: r.documents[0]!.revision,
      lineId: r.entries[0]!.lineId,
    };
    const input = {
      accountId,
      cutoff: r.cutoff,
      snapshot: r.snapshot,
      pairs: [pair],
      confirmed: true as const,
    };
    await expect(
      api.autoMatch({ ...input, pairs: [{ ...pair, lineId: r.entries[1]!.lineId }] }),
    ).rejects.toThrow('方向');
    await expect(api.autoMatch({ ...input, confirmed: false as true })).rejects.toThrow();
    const viewer = call(app, await app.addUser('auto-viewer', { permissions: ['cashier.view'] }));
    await expect(viewer.autoMatch(input)).rejects.toThrow('权限');
    await create({ amount: 303 });
    await expect(api.autoMatch(input)).rejects.toThrow('已变化');
    expect((await reconcile()).groups).toEqual([]);
  });
  it('批次后续写入失败回滚全部勾账组，已关月同样阻止', async () => {
    await create({ amount: 101 });
    await create({ amount: 202 });
    await api.generate({ ...(await generation()), requestKey: randomUUID() });
    await posted();
    const r = await reconcile();
    const input = {
      accountId,
      cutoff: r.cutoff,
      snapshot: r.snapshot,
      pairs: matchSuggestions(r.documents, r.entries).map((s) => ({
        documentId: s.document.id,
        revision: s.document.revision,
        lineId: s.candidates[0]!.lineId,
      })),
      confirmed: true as const,
    };
    await sql`CREATE TRIGGER cashier_auto_failure BEFORE INSERT ON cashier_match WHEN NEW.amount = 202 BEGIN SELECT RAISE(FAIL, '合成第二组失败'); END`.execute(
      app.svc.db,
    );
    await expect(api.autoMatch(input)).rejects.toThrow('合成第二组失败');
    expect((await reconcile()).groups).toEqual([]);
    expect(
      await app.svc.db
        .withTables<CashierTables>()
        .selectFrom('cashier_match_document')
        .selectAll()
        .execute(),
    ).toEqual([]);
    await sql`DROP TRIGGER cashier_auto_failure`.execute(app.svc.db);
    const p = await api.periods();
    await api.closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
    await expect(api.autoMatch(input)).rejects.toThrow('已经结账');
    expect((await reconcile()).groups).toEqual([]);
  });
});
