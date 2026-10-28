import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { Decimal, qtyToE6 } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import type { RuleInput } from '../shared';
import { call, errorData, generateAll, rule, snapshot, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());

async function setup(amount = 71001, conversion = true) {
  const target = await app.svc.accounts.create(
    {
      code: '1701',
      name: '合成外币数量转入',
      categoryId: 'asset',
      currency: 'USD',
      quantityUnit: '件',
      dimensions: [{ type: 'department', required: true }],
    },
    app.book.codeScheme,
  );
  const department = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: amount },
        { account: '4103', credit: amount },
      ],
    },
  ]);
  const data = await rule(app, {
    kind: 'custom',
    code: 'CONVERT',
    targetAccountId: target.id,
    targetDimensions: { department },
    sources: [
      { accountId: (await app.svc.accounts.require('4001')).id, mode: 'balance', ratio: '100' },
    ],
    ...(conversion
      ? {
          targetConversion: {
            currency: 'USD',
            exchangeRate: '7.1',
            quantityUnit: '件',
            unitPrice: '2.55',
          },
        }
      : {}),
  });
  return { target, data, department };
}

it.each([71001, -71001])(
  'w_xt_jzwh / w_zw_ydjz：显式转入换算、舍入及正负余额 %i，生成来源锁与合法删除重建',
  async (amount) => {
    const { target, data, department } = await setup(amount);
    const api = call(app);
    await api.saveRule({ data });
    const before = snapshot(app);
    const preview = await api.preview({ period: 202601, ruleIds: [1] });
    expect(snapshot(app)).toBe(before);
    const expected = {
      accountId: target.id,
      debit: amount > 0 ? 71001 : 0,
      credit: amount < 0 ? 71001 : 0,
      currency: 'USD',
      exchangeRate: '7.1',
      fcAmount: 10000,
      quantity: '278.435294',
      unitPrice: '2.55',
      dimensions: { department },
    };
    expect(preview.items[0]!.lines.find((l) => l.accountId === target.id)).toMatchObject(expected);
    const { result, input } = await generateAll(app);
    const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
    expect(voucher).toMatchObject({
      status: 'pending',
      debitTotal: 71001,
      creditTotal: 71001,
      source: { module: 'period-close', type: 'closing', id: '202601:1' },
    });
    expect(voucher.lines.find((l) => l.accountId === target.id)).toMatchObject(expected);
    const generated = snapshot(app);
    await api.generate(input);
    expect(snapshot(app)).toBe(generated);
    await expect(app.svc.vouchers.delete(voucher.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    expect(snapshot(app)).toBe(generated);
    await api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true });
    expect((await api.check({ period: 202601 })).generated).toEqual([]);
    const rebuilt = await generateAll(app);
    expect(
      (await app.svc.vouchers.get(rebuilt.result.generated[0]!.id))!.lines.find(
        (l) => l.accountId === target.id,
      ),
    ).toMatchObject(expected);
  },
);

it.each([
  { exchangeRate: '0' },
  { exchangeRate: '-1' },
  { unitPrice: '0' },
  { unitPrice: '-1' },
  { currency: 'EUR' },
  { quantityUnit: '吨' },
])('w_xt_jzwh：无效或不匹配转入换算 %j 拒绝且所有行不变', async (patch) => {
  const { data } = await setup();
  const before = snapshot(app);
  expect(
    (
      await errorData(
        call(app).saveRule({
          data: { ...data, targetConversion: { ...data.targetConversion, ...patch } },
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_TARGET_CONVERSION');
  expect(snapshot(app)).toBe(before);
});

it.each([1, -1])('w_zw_ydjz：转入外币分和六位数量在半单位处四舍五入 %i', async (amount) => {
  const { data, target } = await setup(amount);
  await call(app).saveRule({
    data: {
      ...data,
      targetConversion: {
        currency: 'USD',
        exchangeRate: '2',
        quantityUnit: '件',
        unitPrice: '20000',
      },
    },
  });
  const { result } = await generateAll(app);
  const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
  expect(voucher.lines.find((l) => l.accountId === target.id)).toMatchObject({
    debit: amount > 0 ? 1 : 0,
    credit: amount < 0 ? 1 : 0,
    fcAmount: 1,
    quantity: '0.000001',
  });
});

it('w_zw_ydjz_1_bak：后序换算凭证写入失败时，前序凭证、关联及日志全部回滚', async () => {
  const { data, target } = await setup();
  const api = call(app);
  await api.saveRule({
    data: await rule(app, {
      code: 'FIRST',
      kind: 'custom',
      sources: [
        { accountId: (await app.svc.accounts.require('4001')).id, mode: 'balance', ratio: '50' },
      ],
    }),
  });
  await api.saveRule({ data: { ...data, order: 2 } });
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec(`CREATE TRIGGER period_close_test_conversion_fail BEFORE INSERT ON voucher_line
    WHEN NEW.account_id = ${target.id} BEGIN SELECT RAISE(ABORT,'测试换算后序失败'); END`);
  const preview = await api.preview({ period: 202601, ruleIds: [1, 2] });
  expect(preview.items.map((i) => i.debit)).toEqual([35501, 35500]);
  const before = snapshot(app);
  await expect(
    api.generate({
      period: 202601,
      ruleIds: [1, 2],
      confirmed: true,
      previewToken: preview.previewToken,
    }),
  ).rejects.toThrow('测试换算后序失败');
  expect(snapshot(app)).toBe(before);
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
});

it('w_zw_ydjz：旧定义缺少映射继续明确阻止，汇率/数量越界及零本币辅助余额不写库', async () => {
  const { data, target } = await setup(71001, false);
  const api = call(app);
  await api.saveRule({ data });
  let before = snapshot(app);
  expect((await errorData(api.preview({ period: 202601, ruleIds: [1] }))).code).toBe(
    'PERIOD_CLOSE_TARGET_SEMANTICS',
  );
  expect(snapshot(app)).toBe(before);
  for (const patch of [
    { exchangeRate: '0.0000000000000000001', unitPrice: '2.55' },
    { exchangeRate: '7.1', unitPrice: '0.0000000000000000001' },
  ]) {
    const saved = (await api.rules())[0]!;
    await api.saveRule({
      id: saved.id,
      revision: saved.revision,
      data: {
        ...data,
        targetConversion: { currency: 'USD', quantityUnit: '件', ...patch },
      },
    });
    before = snapshot(app);
    expect((await errorData(api.preview({ period: 202601, ruleIds: [1] }))).code).toBe(
      'PERIOD_CLOSE_TARGET_RANGE',
    );
    expect(snapshot(app)).toBe(before);
  }
  await api.removeRule({ id: 1 });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: target.id,
    currency: 'USD',
    dimensions: { department: (await app.svc.dimensions.getByCode('department', '01'))!.id },
    balance: 0,
    fcBalance: 1,
    quantity: '1',
  });
  await api.saveRule({
    data: await rule(app, {
      kind: 'custom',
      sources: [{ accountId: target.id, mode: 'balance', ratio: '100' }],
    }),
  });
  before = snapshot(app);
  const current = (await api.rules())[0]!;
  expect((await errorData(api.preview({ period: 202601, ruleIds: [current.id] }))).code).toBe(
    'PERIOD_CLOSE_ZERO_AUXILIARY',
  );
  expect(snapshot(app)).toBe(before);
});

it('w_zw_ydjz：设置改变使旧预览失效，币种/单位档案改变不能沿用映射', async () => {
  const { data, target } = await setup();
  const api = call(app);
  await api.saveRule({ data });
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  await api.saveRule({
    id: 1,
    revision: 1,
    data: { ...data, targetConversion: { ...data.targetConversion, exchangeRate: '7.2' } },
  });
  let before = snapshot(app);
  expect(
    (
      await errorData(
        api.generate({
          period: 202601,
          ruleIds: [1],
          confirmed: true,
          previewToken: preview.previewToken,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_PREVIEW_CHANGED');
  expect(snapshot(app)).toBe(before);
  for (const patch of [{ currency_code: null }, { quantity_unit: '吨' }]) {
    await app.svc.db.updateTable('account').set(patch).where('id', '=', target.id).execute();
    before = snapshot(app);
    expect((await errorData(api.preview({ period: 202601, ruleIds: [1] }))).code).toBe(
      'PERIOD_CLOSE_TARGET_CONVERSION',
    );
    expect(snapshot(app)).toBe(before);
    await app.svc.db
      .updateTable('account')
      .set({ currency_code: 'USD', quantity_unit: '件' })
      .where('id', '=', target.id)
      .execute();
  }
});

it('w_zw_ydjz / w_zw_fz/qxfz：换算后结账往返、逆年结在线备份及反过账删除恢复原账', async () => {
  const { data } = await setup();
  const api = call(app);
  await api.saveRule({ data });
  const opening = await app.svc.opening.list(2026);
  const original = await app.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202601,
    rollup: false,
    includeZero: true,
  });
  const { result } = await generateAll(app);
  await app.addUser('reviewer');
  const reviewerRow = await app.svc.db
    .selectFrom('app_user')
    .select('id')
    .where('code', '=', 'reviewer')
    .executeTakeFirstOrThrow();
  const reviewer = createCoreServices({
    ...app.svc.ctx,
    user: (await loadServiceUser(app.svc.db, reviewerRow.id))!,
  });
  const voucherId = result.generated[0]!.id;
  await reviewer.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
  await api.post({ from: 202601, to: 202601 });
  const posted = await app.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202601,
    rollup: false,
    includeZero: true,
  });
  const range = { from: 202601, to: 202612 };
  const closePreview = await api.closeRangePreview(range);
  await api.closeRange({ ...range, confirmed: true, previewToken: closePreview.previewToken });
  const sourceVouchers = await app.svc.vouchers.list();
  await api.yearEnd({ year: 2026, confirmed: true });
  const next = await app.svc.opening.list(2027);
  expect(next.find((r) => r.currency === 'USD')).toMatchObject({
    balance: 71001,
    fcBalance: 10000,
    quantity: '278.435294',
    ytdDebit: 0,
    ytdCredit: 0,
  });
  const backup = await api.backupReverseYear({ year: 2026 });
  await api.reverseYear({
    year: 2026,
    backupId: backup.backupId,
    confirmed: true,
    confirmText: '撤销2026年年结',
  });
  expect(await app.svc.vouchers.list()).toEqual(sourceVouchers);
  expect(await app.svc.opening.list(2026)).toEqual(opening);
  expect(await app.svc.opening.list(2027)).toEqual([]);
  await api.reopen({ from: 202601, to: 202612, confirmed: true });
  expect(
    await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      rollup: false,
      includeZero: true,
    }),
  ).toEqual(posted);
  await api.unpost({ from: 202601, to: 202601, confirmed: true });
  await reviewer.vouchers.changeStatus({ ids: [voucherId], to: 'pending' });
  await api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true });
  // 原业务也被批量反过账；按原状态恢复后核对原账及四维/外币/数量。
  const originalIds = (await app.svc.vouchers.list()).items.map((v) => v.id);
  await app.svc.vouchers.changeStatus({ ids: originalIds, to: 'posted' });
  expect(
    await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      rollup: false,
      includeZero: true,
    }),
  ).toEqual(original);
});

it('fast-check w_zw_ydjz：换算保持整数金额、六位数量与借贷相等', async () => {
  const { data, target } = await setup();
  const api = call(app);
  await api.saveRule({ data });
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1000000 }),
      fc.integer({ min: 1, max: 1000000 }),
      async (rateCents, priceCents) => {
        const saved = (await api.rules())[0]!;
        const conversion: RuleInput['targetConversion'] = {
          currency: 'USD',
          quantityUnit: '件',
          exchangeRate: new Decimal(rateCents).div(100).toFixed(),
          unitPrice: new Decimal(priceCents).div(100).toFixed(),
        };
        await api.saveRule({
          id: saved.id,
          revision: saved.revision,
          data: {
            ...data,
            targetConversion: conversion,
          },
        });
        const { result } = await generateAll(app);
        const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
        const line = voucher.lines.find((l) => l.accountId === target.id)!;
        expect(voucher.debitTotal).toBe(71001);
        expect(voucher.creditTotal).toBe(71001);
        expect(Number.isSafeInteger(line.fcAmount)).toBe(true);
        expect(Number.isSafeInteger(qtyToE6(line.quantity!))).toBe(true);
        // 独立整数舍入参照，避免用生产 Decimal 公式复算自己。
        const rounded = (n: bigint, d: bigint) => Number((n * 2n + d) / (d * 2n));
        expect(line.fcAmount).toBe(rounded(71001n * 100n, BigInt(rateCents)));
        expect(qtyToE6(line.quantity!)).toBe(rounded(71001n * 1000000n, BigInt(priceCents)));
        await api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true });
      },
    ),
    { numRuns: 12 },
  );
}, 30000);
