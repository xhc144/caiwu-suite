import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TRPCError } from '@trpc/server';
import { convertCurrency, type BusinessError } from '@caiwu/core';
import { sql } from '@caiwu/db';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { matchSuggestions, safeSum, type DocumentInput } from '../shared';
import cashierServer from '../server';
import type { CashierTables } from '../server/migrations';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(cashierServer, token);
let api: ReturnType<typeof caller>;
let accountId: number;
let bankId: number;
let oppositeId: number;
let cashflow: number;
let voucherTypeId: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
  api = caller(app);
  bankId = (await app.svc.accounts.require('100202')).id;
  oppositeId = (await app.svc.accounts.require('6603')).id;
  cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  voucherTypeId = (await app.svc.reference.voucherTypes())[0]!.id;
  await api.enable({ period: 202601 });
  accountId = (
    await api.saveAccount({
      data: {
        name: '合成美元账户',
        coreAccountId: bankId,
        currency: 'USD',
        opening: 710000,
        foreignOpening: 100000,
      },
    })
  ).id;
  await app.svc.opening.upsert({
    year: 2026,
    accountId: bankId,
    currency: 'USD',
    balance: 710000,
    fcBalance: 100000,
  });
});
afterEach(async () => app.close());
const data = (overrides: Partial<DocumentInput> = {}): DocumentInput => ({
  accountId,
  period: 202601,
  date: '2026-01-10',
  summary: '合成美元收付',
  direction: 'receipt',
  amount: 71000,
  foreignAmount: 10000,
  exchangeRate: '7.1',
  oppositeAccountId: oppositeId,
  dimensions: { cashflow },
  ...overrides,
});
const create = (overrides: Partial<DocumentInput> = {}) =>
  api.createDocument({ ...data(overrides), requestKey: randomUUID() });
const documents = () => api.documents({ accountId });
const reconcile = () => api.reconcile({ accountId, cutoff: '2026-01-31' });
async function generate() {
  const rows = await documents();
  return api.generate({
    documents: rows.map((d) => ({ id: d.id, revision: d.revision })),
    mode: 'individual',
    date: '2026-01-10',
    voucherTypeId,
    requestKey: randomUUID(),
  });
}
async function post() {
  const ids = [
    ...new Set((await documents()).filter((d) => d.voucherId != null).map((d) => d.voucherId!)),
  ];
  await app.svc.vouchers.changeStatus({ ids, to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids, to: 'posted' });
}
async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as TRPCError,
  );
  expect(error).not.toBeNull();
  return (error!.cause as BusinessError)?.data?.code ?? error!.code;
}

describe('出纳外币真实业务链', () => {
  it('w_cn_lr_qc 原币、本位币期初独立保存且账务期初只读核对', async () => {
    expect((await api.accounts({}))[0]).toMatchObject({
      currency: 'USD',
      opening: 710000,
      foreignOpening: 100000,
      coreOpening: 710000,
      coreForeignOpening: 100000,
    });
    await api.saveAccount({
      edit: { id: accountId, revision: 1 },
      data: {
        name: '美元户改名',
        coreAccountId: bankId,
        currency: 'USD',
        opening: 710000,
        foreignOpening: 100000,
      },
    });
    expect((await app.svc.opening.list(2026)).find((o) => o.accountId === bankId)).toMatchObject({
      balance: 710000,
      fcBalance: 100000,
    });
    expect(await api.exchangeRate({ currency: 'USD', period: 202601 })).toBe('7.1');
  });

  it('w_cn_lr_add／w_cn_pz 外币收付生成保留汇率与原币，过账后两种余额一致', async () => {
    await create({ summary: '美元到账' });
    await create({ summary: '美元付款', direction: 'payment', amount: 35500, foreignAmount: 5000 });
    const batch = await generate();
    const rows = await documents();
    expect(rows.map((d) => [d.foreignAmount, d.exchangeRate, d.foreignSigned])).toEqual([
      [10000, '7.1', 10000],
      [5000, '7.1', -5000],
    ]);
    for (const row of rows) {
      const voucher = (await app.svc.vouchers.get(row.voucherId!))!;
      expect(voucher.lines.find((l) => l.accountId === bankId)).toMatchObject({
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: row.foreignAmount,
        debit: row.direction === 'receipt' ? row.amount : 0,
        credit: row.direction === 'payment' ? row.amount : 0,
      });
      expect(voucher.lines.find((l) => l.accountId === oppositeId)!.fcAmount).toBeNull();
      expect(voucher.debitTotal).toBe(voucher.creditTotal);
      expect(voucher.source).toEqual({
        module: 'cashier',
        type: 'batch',
        id: String(batch.batchId),
      });
    }
    await post();
    const state = await reconcile();
    expect(state.adjustment).toMatchObject({
      cashBalance: 745500,
      coreBalance: 745500,
      difference: 0,
    });
    expect(state.foreignAdjustment).toMatchObject({
      cashOpening: 100000,
      coreOpening: 100000,
      cashBalance: 105000,
      coreBalance: 105000,
      difference: 0,
    });
    expect(state.entries.map((e) => e.foreignSigned)).toEqual([10000, -5000]);
    expect(await errorCode(api.revoke({ batchId: batch.batchId, confirmed: true }))).toBe(
      'CASHIER_VOUCHER_LOCKED',
    );
  });

  it('w_cn_pz 同币种外币对方科目完整保存辅助项与原币，异币科目拒绝', async () => {
    const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!.id;
    const usd = await app.svc.accounts.create(
      {
        code: '112201',
        name: '合成美元应收',
        currency: 'USD',
        dimensions: [{ type: 'partner', required: true }],
      },
      [4, 2, 2],
    );
    await app.svc.db
      .insertInto('currency')
      .values({ code: 'EUR', name: '合成欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
      .execute();
    const other = await app.svc.accounts.create(
      { code: '112202', name: '合成异币应收', currency: 'EUR' },
      [4, 2, 2],
    );
    expect(await errorCode(create({ oppositeAccountId: other.id }))).toBe('CASHIER_CURRENCY');
    await create({ oppositeAccountId: usd.id, dimensions: { cashflow, partner } });
    await generate();
    const voucher = (await app.svc.vouchers.get((await documents())[0]!.voucherId!))!;
    expect(voucher.lines.find((l) => l.accountId === usd.id)).toMatchObject({
      currency: 'USD',
      exchangeRate: '7.1',
      fcAmount: 10000,
      credit: 71000,
      dimensions: { partner },
    });
  });

  it('w_cn_dz 双币等额自动勾账和取消保留所有余额', async () => {
    await create();
    await create({ amount: 35500, foreignAmount: 5000, direction: 'payment' });
    await generate();
    await post();
    const before = await reconcile();
    const suggestions = matchSuggestions(before.documents, before.entries);
    expect(suggestions.map((s) => [s.unique, s.candidates.length])).toEqual([
      [true, 1],
      [true, 1],
    ]);
    const result = await api.autoMatch({
      accountId,
      cutoff: before.cutoff,
      snapshot: before.snapshot,
      pairs: suggestions.map((s) => ({
        documentId: s.document.id,
        revision: s.document.revision,
        lineId: s.candidates[0]!.lineId,
      })),
      confirmed: true,
    });
    const after = await reconcile();
    expect(after.groups.every((g) => g.valid)).toBe(true);
    expect(after.foreignAdjustment).toMatchObject({
      cashBalance: 105000,
      coreBalance: 105000,
      cashOutstanding: 0,
      coreOutstanding: 0,
    });
    for (const id of result.ids) await api.unmatch({ id, confirmed: true });
    expect((await reconcile()).foreignAdjustment).toEqual(before.foreignAdjustment);
    expect((await reconcile()).adjustment).toEqual(before.adjustment);
  });

  it('w_cn_dz 本位币相等但原币不同拒绝手工与自动勾账，不产生误匹配建议', async () => {
    await create();
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          {
            account: '100202',
            debit: 71000,
            currency: 'USD',
            rate: '3.55',
            fcAmount: 20000,
            dims: { cashflow: 'CF01' },
          },
          { account: '6603', credit: 71000 },
        ],
      },
    ]);
    const before = await reconcile();
    expect(before.documents[0]!.signed).toBe(before.entries[0]!.signed);
    expect(matchSuggestions(before.documents, before.entries)[0]!.candidates).toEqual([]);
    expect(
      await errorCode(
        api.match({
          accountId,
          cutoff: before.cutoff,
          snapshot: before.snapshot,
          documents: before.documents.map((d) => ({ id: d.id, revision: d.revision })),
          lineIds: before.entries.map((e) => e.lineId),
          confirmed: true,
        }),
      ),
    ).toBe('CASHIER_MATCH_FOREIGN_AMOUNT');
    expect(
      await errorCode(
        api.autoMatch({
          accountId,
          cutoff: before.cutoff,
          snapshot: before.snapshot,
          pairs: [
            {
              documentId: before.documents[0]!.id,
              revision: before.documents[0]!.revision,
              lineId: before.entries[0]!.lineId,
            },
          ],
          confirmed: true,
        }),
      ),
    ).toBe('CASHIER_MATCH_AMOUNT');
    expect((await reconcile()).groups).toEqual([]);
  });

  it('w_cn_dz 多对多双币等额可手工勾账，外币不按本币重复推算', async () => {
    await create({ amount: 7100, foreignAmount: 1000 });
    await create({ amount: 14200, foreignAmount: 2000 });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          {
            account: '100202',
            debit: 21300,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 3000,
            dims: { cashflow: 'CF01' },
          },
          { account: '6603', credit: 21300 },
        ],
      },
    ]);
    const state = await reconcile();
    const group = await api.match({
      accountId,
      cutoff: state.cutoff,
      snapshot: state.snapshot,
      documents: state.documents.map((d) => ({ id: d.id, revision: d.revision })),
      lineIds: state.entries.map((e) => e.lineId),
      confirmed: true,
    });
    expect(
      await app.svc.db
        .withTables<CashierTables>()
        .selectFrom('cashier_match')
        .selectAll()
        .where('id', '=', group.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ foreign_amount: 3000, amount: 21300 });
    expect((await reconcile()).groups[0]!.valid).toBe(true);
  });

  it('w_cn_lr_add 缺原币或汇率、错误折算、负数与零汇率一律不保存', async () => {
    expect(await errorCode(create({ foreignAmount: null }))).toBe('CASHIER_FOREIGN_REQUIRED');
    expect(await errorCode(create({ exchangeRate: null }))).toBe('CASHIER_FOREIGN_REQUIRED');
    expect(await errorCode(create({ amount: 71001 }))).toBe('CASHIER_FOREIGN_CONVERSION');
    for (const exchangeRate of ['0', '-1', 'NaN', '1e1000', ''])
      await expect(create({ exchangeRate })).rejects.toThrow();
    for (const foreignAmount of [0, -1, Number.MAX_SAFE_INTEGER + 1])
      await expect(create({ foreignAmount })).rejects.toThrow();
    expect(await documents()).toEqual([]);
  });

  it('w_cn_lr_add 四舍五入到最小货币单位，无法入账的微额与溢出不留下单据', async () => {
    const row = await create({ foreignAmount: 1, exchangeRate: '0.5', amount: 1 });
    expect((await documents()).find((d) => d.id === row.id)).toMatchObject({
      foreignAmount: 1,
      amount: 1,
      exchangeRate: '0.5',
    });
    expect(await errorCode(create({ foreignAmount: 1, exchangeRate: '0.49', amount: 1 }))).toBe(
      'CASHIER_FOREIGN_ROUNDING',
    );
    expect(
      await errorCode(
        create({ foreignAmount: Number.MAX_SAFE_INTEGER, exchangeRate: '2', amount: 1 }),
      ),
    ).toBe('CASHIER_AMOUNT_RANGE');
    expect(await documents()).toHaveLength(1);
  });

  it('w_cn_lr_qc／w_cn_lr_add 币种不对应、已停用币种及本位币填写外币均拒绝', async () => {
    expect(
      await errorCode(
        api.saveAccount({
          data: { name: '错币种', coreAccountId: bankId, currency: 'CNY', opening: 0 },
        }),
      ),
    ).toBe('CASHIER_CURRENCY');
    const baseBank = (await app.svc.accounts.require('100201')).id;
    const baseAccount = (
      await api.saveAccount({
        data: { name: '合成本币', coreAccountId: baseBank, currency: 'CNY', opening: 0 },
      })
    ).id;
    expect(await errorCode(create({ accountId: baseAccount }))).toBe('CASHIER_BASE_FOREIGN');
    expect(
      await errorCode(
        api.createDocument({
          ...data({
            accountId: baseAccount,
            foreignAmount: null,
            exchangeRate: null,
            oppositeAccountId: bankId,
          }),
          requestKey: randomUUID(),
        }),
      ),
    ).toBe('CASHIER_CURRENCY');
    await app.svc.db
      .updateTable('currency')
      .set({ disabled: 1 })
      .where('code', '=', 'USD')
      .execute();
    expect(await errorCode(create())).toBe('CASHIER_CURRENCY');
    expect(await documents()).toEqual([]);
  });

  it('w_cn_lr_add 同一新增请求幂等、内容变化和已使用原币期初修改均阻止', async () => {
    const input = { ...data(), requestKey: randomUUID() };
    const saved = await api.createDocument(input);
    expect(await api.createDocument(input)).toEqual(saved);
    expect(await errorCode(api.createDocument({ ...input, exchangeRate: '7.10' }))).toBe(
      'CASHIER_IDEMPOTENCY',
    );
    expect(
      await errorCode(
        api.saveAccount({
          edit: { id: accountId, revision: 1 },
          data: {
            name: '美元',
            coreAccountId: bankId,
            currency: 'USD',
            opening: 710000,
            foreignOpening: 99999,
          },
        }),
      ),
    ).toBe('CASHIER_OPENING_LOCKED');
    expect(await documents()).toHaveLength(1);
  });

  it('w_cn_lr_add 无编辑权限、已结出纳月及已结总账月拒绝外币写入', async () => {
    const viewer = caller(app, await app.addUser('fx-viewer', { permissions: ['cashier.view'] }));
    expect(await errorCode(viewer.createDocument({ ...data(), requestKey: randomUUID() }))).toBe(
      'FORBIDDEN',
    );
    await app.svc.periods.setStatus(202601, 'closed');
    expect(await errorCode(create())).toBe('PERIOD_CLOSED');
    await app.svc.periods.setStatus(202601, 'open');
    const state = await api.periods();
    await api.closePeriod({ period: state.current, snapshot: state.snapshot, confirmed: true });
    expect(await errorCode(create())).toBe('CASHIER_PERIOD_CLOSED');
    expect(await documents()).toEqual([]);
  });

  it('w_cn_pz 外币第二张凭证关联保存失败时全部凭证与原单状态回滚', async () => {
    await create();
    const second = await create({ amount: 35500, foreignAmount: 5000 });
    await sql`CREATE TRIGGER cashier_fx_failure BEFORE INSERT ON cashier_batch_document WHEN NEW.document_id = ${sql.lit(second.id)} BEGIN SELECT RAISE(ABORT, '合成外币关联失败'); END`.execute(
      app.svc.db,
    );
    await expect(generate()).rejects.toThrow('合成外币关联失败');
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    expect((await documents()).every((d) => d.voucherId == null && d.revision === 1)).toBe(true);
  });

  it('w_cn_dz 付款大于期初时保留原币负余额，借贷方向不会取绝对值', async () => {
    await create({ direction: 'payment', amount: 781000, foreignAmount: 110000 });
    await generate();
    await post();
    const state = await reconcile();
    expect(state.documents[0]!.foreignSigned).toBe(-110000);
    expect(state.entries[0]!.foreignSigned).toBe(-110000);
    expect(state.foreignAdjustment).toMatchObject({
      cashBalance: -10000,
      coreBalance: -10000,
      difference: 0,
    });
    expect(state.adjustment).toMatchObject({
      cashBalance: -71000,
      coreBalance: -71000,
      difference: 0,
    });
  });

  it('w_cn_pz 随机收付款的本位币借贷与原币方向累计保持一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ amount: fc.integer({ min: 2, max: 100000 }), payment: fc.boolean() }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.constantFrom('0.5', '1', '7.1', '12.345'),
        async (rows, rate) => {
          const fresh = await createTestApp({ modules: [cashierServer] });
          try {
            const a = caller(fresh);
            await a.enable({ period: 202601 });
            const bank = (await fresh.svc.accounts.require('100202')).id;
            const opposite = (await fresh.svc.accounts.require('6603')).id;
            const cf = (await fresh.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
            const acc = (
              await a.saveAccount({
                data: {
                  name: '随机美元',
                  coreAccountId: bank,
                  currency: 'USD',
                  opening: 0,
                  foreignOpening: 0,
                },
              })
            ).id;
            for (const row of rows)
              await a.createDocument({
                accountId: acc,
                period: 202601,
                date: '2026-01-10',
                summary: '随机合成外币',
                direction: row.payment ? 'payment' : 'receipt',
                amount: convertCurrency(row.amount, rate),
                foreignAmount: row.amount,
                exchangeRate: rate,
                oppositeAccountId: opposite,
                dimensions: { cashflow: cf },
                requestKey: randomUUID(),
              });
            const docs = await a.documents({ accountId: acc });
            await a.generate({
              documents: docs.map((d) => ({ id: d.id, revision: d.revision })),
              mode: 'summary',
              date: '2026-01-10',
              voucherTypeId: (await fresh.svc.reference.voucherTypes())[0]!.id,
              requestKey: randomUUID(),
            });
            const voucher = (await fresh.svc.vouchers.get(
              (await a.documents({ accountId: acc }))[0]!.voucherId!,
            ))!;
            expect(voucher.debitTotal).toBe(voucher.creditTotal);
            await fresh.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
            await fresh.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
            const state = await a.reconcile({ accountId: acc, cutoff: '2026-01-31' });
            expect(state.foreignAdjustment!.cashBalance).toBe(
              safeSum(rows.map((r) => (r.payment ? -r.amount : r.amount))),
            );
            expect(state.foreignAdjustment!.coreBalance).toBe(state.foreignAdjustment!.cashBalance);
            expect(state.adjustment.cashBalance).toBe(
              safeSum(rows.map((r) => (r.payment ? -1 : 1) * convertCurrency(r.amount, rate))),
            );
            expect(state.adjustment.coreBalance).toBe(state.adjustment.cashBalance);
          } finally {
            await fresh.close();
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
