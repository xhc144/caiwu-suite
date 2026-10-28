import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import periodCloseServer from '../server';
import type { ExchangeSettings } from '../shared';
import { closingBuckets } from '../server/buckets';
import { verifyExchangeRuns } from '../server/exchange';
import { call, errorData, rule, snapshot, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());
async function setup(rate = '7.2') {
  const account = await app.svc.accounts.create(
    {
      code: '1701',
      name: '合成外币货币性资产',
      categoryId: 'asset',
      currency: 'USD',
      quantityUnit: '件',
      dimensions: [{ type: 'department', required: true }],
    },
    app.book.codeScheme,
  );
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        {
          account: account.code,
          debit: 71000,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 10000,
          quantity: '2',
          dims: { department: '01' },
        },
        {
          account: account.code,
          credit: 35500,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 5000,
          quantity: '1',
          dims: { department: '02' },
        },
        { account: '4001', credit: 35500 },
      ],
    },
  ]);
  const data: ExchangeSettings = {
    period: 202601,
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    summary: '合成期末汇兑调整',
    accountIds: [account.id],
    rates: [
      {
        currency: 'USD',
        rate,
        gainLossAccountId: (await app.svc.accounts.require('6603')).id,
        dimensions: {},
      },
    ],
  };
  await call(app).saveExchangeSettings(data);
  return { account, data };
}
async function generate() {
  const api = call(app);
  const preview = await api.exchangePreview({ period: 202601 });
  const input = { period: 202601, confirmed: true, previewToken: preview.previewToken };
  return { preview, input, result: await api.generateExchange(input) };
}
async function remove() {
  const plan = await call(app).deleteExchangePreview({ period: 202601 });
  return call(app).deleteExchange({ period: 202601, confirmed: true, plan: plan.plan });
}

it('w_pzedit_hlgl_rq / w_xt_fbwh：辅助项正负余额独立折算，生成待审核来源凭证且外币数量不变', async () => {
  const { account } = await setup();
  const api = call(app);
  const before = snapshot(app);
  const preview = await api.exchangePreview({ period: 202601 });
  expect(snapshot(app)).toBe(before);
  expect(preview.rows).toMatchObject([
    {
      accountId: account.id,
      bookBalance: 71000,
      foreignBalance: 10000,
      translatedBalance: 72000,
      difference: 1000,
    },
    {
      accountId: account.id,
      bookBalance: -35500,
      foreignBalance: -5000,
      translatedBalance: -36000,
      difference: -500,
    },
  ]);
  expect(preview.debit).toBe(1500);
  expect(preview.credit).toBe(1500);
  const { result, input } = await generate();
  const voucher = (await app.svc.vouchers.get(result.id!))!;
  expect(voucher).toMatchObject({
    status: 'pending',
    source: { module: 'period-close', type: 'exchange', id: '202601' },
    closingKind: 'exchange',
    debitTotal: 1500,
    creditTotal: 1500,
  });
  const changes = voucher.lines.filter((l) => l.accountId === account.id);
  expect(
    changes.map((l) => [l.debit, l.credit, l.fcAmount, l.quantity, l.cashflowDirection]),
  ).toEqual([
    [1000, 0, 0, '0', null],
    [0, 500, 0, '0', null],
  ]);
  expect(new Set(changes.map((l) => l.dimensions.department)).size).toBe(2);
  const generated = snapshot(app);
  expect(await api.generateExchange(input)).toMatchObject({ id: result.id, existing: true });
  expect(snapshot(app)).toBe(generated);
  await expect(app.svc.vouchers.delete(result.id!)).rejects.toMatchObject({
    data: { code: 'VOUCHER_FROM_SOURCE' },
  });
  expect(snapshot(app)).toBe(generated);
  const original = [...(await closingBuckets(app.svc, 202601, [], false)).values()].filter(
    (b) => b.accountId === account.id,
  );
  await app.svc.vouchers.changeStatus({ ids: [result.id!], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [result.id!], to: 'posted' });
  const posted = [...(await closingBuckets(app.svc, 202601, [], false)).values()].filter(
    (b) => b.accountId === account.id,
  );
  expect(posted.map((b) => [b.amount, b.fc, b.qty])).toEqual([
    [72000, 10000, 2000000],
    [-36000, -5000, -1000000],
  ]);
  expect(posted.map((b) => [b.fc, b.qty])).toEqual(original.map((b) => [b.fc, b.qty]));
  await verifyExchangeRuns(app.svc, 202601, 202601);
});

it('w_xt_fbwh：已使用的汇率不可覆盖，撤销后可改汇率重新生成', async () => {
  const { data } = await setup();
  const { result } = await generate();
  const before = snapshot(app);
  expect(
    (
      await errorData(
        call(app).saveExchangeSettings({ ...data, rates: [{ ...data.rates[0]!, rate: '7.3' }] }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_FX_USED');
  expect(snapshot(app)).toBe(before);
  await remove();
  expect(await app.svc.vouchers.get(result.id!)).toBeNull();
  await call(app).saveExchangeSettings({ ...data, rates: [{ ...data.rates[0]!, rate: '7.3' }] });
  const rebuilt = await generate();
  expect(rebuilt.preview.rows.map((r) => r.difference)).toEqual([2000, -1000]);
});

it('w_pzedit_hlgl_rq：取消和过期预览不写账；修改汇率、余额或档案须重新预览', async () => {
  const { data, account } = await setup();
  const api = call(app);
  const p = await api.exchangePreview({ period: 202601 });
  let before = snapshot(app);
  expect(
    (
      await errorData(
        api.generateExchange({ period: 202601, confirmed: false, previewToken: p.previewToken }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_FX_CONFIRM');
  expect(snapshot(app)).toBe(before);
  await api.saveExchangeSettings({ ...data, rates: [{ ...data.rates[0]!, rate: '7.3' }] });
  before = snapshot(app);
  expect(
    (
      await errorData(
        api.generateExchange({ period: 202601, confirmed: true, previewToken: p.previewToken }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_FX_PREVIEW_CHANGED');
  expect(snapshot(app)).toBe(before);
  const current = await api.exchangePreview({ period: 202601 });
  await app.svc.db
    .updateTable('account')
    .set({ name: '已修改的合成科目' })
    .where('id', '=', account.id)
    .execute();
  before = snapshot(app);
  expect(
    (
      await errorData(
        api.generateExchange({
          period: 202601,
          confirmed: true,
          previewToken: current.previewToken,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_FX_PREVIEW_CHANGED');
  expect(snapshot(app)).toBe(before);
});

it.each(['0', '-7.2'])(
  'w_xt_fbwh：非法期末汇率 %s、非损益科目和重复币种均拒绝且保留设置',
  async (rate) => {
    const { data } = await setup();
    const api = call(app);
    const before = snapshot(app);
    for (const rates of [
      [{ ...data.rates[0]!, rate }],
      [{ ...data.rates[0]!, gainLossAccountId: (await app.svc.accounts.require('4001')).id }],
      [...data.rates, ...data.rates],
    ]) {
      await expect(api.saveExchangeSettings({ ...data, rates })).rejects.toThrow();
      expect(snapshot(app)).toBe(before);
    }
  },
);

it('u_hlgl：未过账正式凭证阻止汇兑，草稿警示；缺汇率及停用辅助项不生成', async () => {
  const { data } = await setup();
  const api = call(app);
  const [pending] = await seedVouchers(app.svc, [
    {
      date: '2026-01-20',
      lines: [
        { account: '4001', debit: 1 },
        { account: '4103', credit: 1 },
      ],
    },
  ]);
  let before = snapshot(app);
  expect((await errorData(api.exchangePreview({ period: 202601 }))).code).toBe(
    'PERIOD_CLOSE_FX_UNPOSTED',
  );
  expect(snapshot(app)).toBe(before);
  await app.svc.vouchers.delete(pending!.id);
  await seedVouchers(app.svc, [{ date: '2026-01-21', status: 'draft', lines: [] }]);
  expect((await api.exchangePreview({ period: 202601 })).drafts).toBe(1);
  before = snapshot(app);
  await expect(api.saveExchangeSettings({ ...data, rates: [] })).rejects.toThrow();
  expect(snapshot(app)).toBe(before);
  const department = (await app.svc.dimensions.getByCode('department', '01'))!;
  await app.svc.db
    .updateTable('dimension_item')
    .set({ disabled: 1 })
    .where('id', '=', department.id)
    .execute();
  before = snapshot(app);
  expect((await errorData(api.exchangePreview({ period: 202601 }))).code).toBe(
    'PERIOD_CLOSE_FX_DIMENSION',
  );
  expect(snapshot(app)).toBe(before);
});

it('w_pzedit_hlgl_rq：中途写入失败时凭证、来源记录和日志一并回滚，可用原预览重试', async () => {
  await setup();
  const api = call(app);
  const p = await api.exchangePreview({ period: 202601 });
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec(
    "CREATE TRIGGER period_close_test_exchange_fail BEFORE INSERT ON period_close_exchange_run BEGIN SELECT RAISE(ABORT,'测试汇兑来源保存失败'); END",
  );
  const before = snapshot(app);
  await expect(
    api.generateExchange({ period: 202601, confirmed: true, previewToken: p.previewToken }),
  ).rejects.toThrow('测试汇兑来源保存失败');
  expect(snapshot(app)).toBe(before);
  raw.exec('DROP TRIGGER period_close_test_exchange_fail');
  expect((await generate()).result.id).toBeGreaterThan(0);
});

it('w_pzedit_hlgl_rq：零差额不制空凭证，零外币本币尾差也可调整', async () => {
  const { account } = await setup('7.1');
  expect((await generate()).result.id).toBeNull();
  await seedVouchers(app.svc, [
    {
      date: '2026-01-25',
      status: 'posted',
      lines: [
        {
          account: account.code,
          debit: 5,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 0,
          quantity: '0',
          dims: { department: '01' },
        },
        { account: '4001', credit: 5 },
      ],
    },
  ]);
  const result = await generate();
  expect(result.preview.rows.map((r) => r.difference)).toEqual([-5, 0]);
  expect(result.preview.lines).toHaveLength(2);
});

it('w_pzedit_hlgl_rq：期间及权限约束由服务端执行，已审核汇兑不得撤销', async () => {
  const { data } = await setup();
  const { result } = await generate();
  const api = call(app);
  const denied = call(app, await app.addUser('fx-viewer', { permissions: ['period-close.view'] }));
  const before = snapshot(app);
  for (const action of [
    () => denied.saveExchangeSettings(data),
    () => denied.generateExchange({ period: 202601, confirmed: true, previewToken: '' }),
    () =>
      denied.deleteExchange({
        period: 202601,
        confirmed: true,
        plan: { ids: [result.id!], expiresAt: 0, fingerprint: '' },
      }),
  ]) {
    expect((await errorData(action())).code).toBe('FORBIDDEN');
    expect(snapshot(app)).toBe(before);
  }
  await app.svc.vouchers.changeStatus({ ids: [result.id!], to: 'audited' });
  await expect(api.deleteExchangePreview({ period: 202601 })).rejects.toThrow();
  await app.svc.periods.setStatus(202601, 'closed');
  const closed = snapshot(app);
  await expect(
    api.generateExchange({ period: 202601, confirmed: true, previewToken: '' }),
  ).rejects.toThrow();
  expect(snapshot(app)).toBe(closed);
});

it('w_pzedit_hlgl_rq：同月后序结转和后月汇兑阻止先删前序汇兑', async () => {
  await setup();
  const api = call(app);
  const january = await generate();
  await app.svc.vouchers.changeStatus({ ids: [january.result.id!], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [january.result.id!], to: 'posted' });
  await api.saveRule({ data: await rule(app) });
  const p = await api.preview({ period: 202601, ruleIds: [1] });
  await api.generate({
    period: 202601,
    ruleIds: [1],
    confirmed: true,
    previewToken: p.previewToken,
  });
  expect((await errorData(api.deleteExchangePreview({ period: 202601 }))).code).toBe(
    'PERIOD_CLOSE_FX_DEPENDENT',
  );
});

it('w_xt_fbwh：删除后重排先显示影响，过期计划不删除，确认计划原子删除及重排', async () => {
  await setup();
  const api = call(app);
  const { result } = await generate();
  await seedVouchers(app.svc, [
    {
      date: '2026-01-28',
      lines: [
        { account: '4001', debit: 1 },
        { account: '4103', credit: 1 },
      ],
    },
  ]);
  await app.svc.voucherPolicy.set({
    ...(await app.svc.voucherPolicy.get()),
    renumberAfterDelete: true,
  });
  const p = await api.deleteExchangePreview({ period: 202601 });
  expect(p.plan.impacts.some((i) => i.oldNumber !== i.number)).toBe(true);
  const before = snapshot(app);
  await expect(
    api.deleteExchange({
      period: 202601,
      confirmed: true,
      plan: { ...p.plan, fingerprint: 'stale' },
    }),
  ).rejects.toThrow();
  expect(snapshot(app)).toBe(before);
  await api.deleteExchange({ period: 202601, confirmed: true, plan: p.plan });
  expect(await app.svc.vouchers.get(result.id!)).toBeNull();
  expect((await app.svc.vouchers.list()).items.map((v) => v.number).sort()).toEqual([1, 2]);
});

it('fast-check w_pzedit_hlgl_rq：正负辅助桶按独立整数参照舍入，逐次制证借贷相等且原币调整为零', async () => {
  const { data } = await setup();
  const api = call(app);
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 20000 }), async (rateHundredth) => {
      const rate = `${Math.trunc(rateHundredth / 100)}.${String(rateHundredth % 100).padStart(2, '0')}`;
      await api.saveExchangeSettings({ ...data, rates: [{ ...data.rates[0]!, rate }] });
      const { preview, result } = await generate();
      const rounded = (n: bigint) => Number((n * BigInt(rateHundredth) * 2n + 100n) / 200n);
      expect(preview.rows.map((r) => r.translatedBalance)).toEqual([
        rounded(10000n),
        -rounded(5000n),
      ]);
      expect(preview.debit).toBe(preview.credit);
      expect(
        preview.lines
          .filter((l) => l.currency)
          .every((l) => l.fcAmount === 0 && l.quantity === '0'),
      ).toBe(true);
      if (result.id) await remove();
    }),
    { numRuns: 12 },
  );
}, 30000);

it('w_pzedit_hlgl_rq：四类辅助项不合并，汇兑损益目标辅助项独立设置；多币种分别使用期末汇率', async () => {
  const source = await app.svc.accounts.create(
    {
      code: '1702',
      name: '合成四维外币往来',
      categoryId: 'asset',
      currency: 'USD',
      dimensions: ['project', 'partner', 'department', 'person'].map((type) => ({
        type: type as 'project' | 'partner' | 'department' | 'person',
        required: true,
      })),
    },
    app.book.codeScheme,
  );
  const eur = await app.svc.db
    .selectFrom('currency')
    .selectAll()
    .where('code', '=', 'USD')
    .executeTakeFirstOrThrow();
  await app.svc.db
    .insertInto('currency')
    .values({ ...eur, code: 'EUR', name: '合成欧元', symbol: '€' })
    .execute();
  const second = await app.svc.accounts.create(
    { code: '1703', name: '合成欧元往来', categoryId: 'liability', currency: 'EUR' },
    app.book.codeScheme,
  );
  const target = await app.svc.accounts.create(
    {
      code: '660301',
      name: '合成辅助汇兑费用',
      categoryId: 'pnl',
      dimensions: [{ type: 'department', required: true }],
    },
    app.book.codeScheme,
  );
  const department = (await app.svc.dimensions.getByCode('department', '02'))!.id;
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        {
          account: '1702',
          debit: 71000,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 10000,
          dims: { project: 'XM01', partner: 'C001', department: '01', person: 'P01' },
        },
        { account: '1703', credit: 80000, currency: 'EUR', rate: '8', fcAmount: 10000 },
        { account: '4001', debit: 9000 },
      ],
    },
  ]);
  const data: ExchangeSettings = {
    period: 202601,
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    summary: '合成多币辅助汇兑',
    accountIds: [source.id, second.id],
    rates: [
      { currency: 'USD', rate: '7.2', gainLossAccountId: target.id, dimensions: { department } },
      { currency: 'EUR', rate: '7.9', gainLossAccountId: target.id, dimensions: { department } },
    ],
  };
  await call(app).saveExchangeSettings(data);
  const { preview, result } = await generate();
  expect(preview.rows.map((r) => [r.currency, r.difference])).toEqual([
    ['USD', 1000],
    ['EUR', 1000],
  ]);
  const sourceLine = preview.lines.find((l) => l.accountId === source.id)!;
  expect(
    ['project', 'partner', 'department', 'person'].every(
      (type) => sourceLine.dimensions?.[type as 'project'] != null,
    ),
  ).toBe(true);
  expect(
    preview.lines
      .filter((l) => l.accountId === target.id)
      .every((l) => l.dimensions?.department === department && l.credit === 1000),
  ).toBe(true);
  expect((await app.svc.vouchers.get(result.id!))!.creditTotal).toBe(2000);
});

it('w_pzedit_hlgl_rq：并发确认只生成同一张汇兑凭证；更早期间不能绕过后期汇兑保护', async () => {
  const { data } = await setup();
  const api = call(app);
  const preview = await api.exchangePreview({ period: 202601 });
  const input = { period: 202601, confirmed: true, previewToken: preview.previewToken };
  const results = await Promise.all([api.generateExchange(input), api.generateExchange(input)]);
  expect(results[0].id).toBe(results[1].id);
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
  await app.svc.vouchers.changeStatus({ ids: [results[0].id!], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [results[0].id!], to: 'posted' });
  await api.saveExchangeSettings({
    ...data,
    period: 202602,
    rates: [{ ...data.rates[0]!, rate: '7.3' }],
  });
  const february = await api.exchangePreview({ period: 202602 });
  await api.generateExchange({
    period: 202602,
    confirmed: true,
    previewToken: february.previewToken,
  });
  const before = snapshot(app);
  expect((await errorData(api.deleteExchangePreview({ period: 202601 }))).code).toBe(
    'PERIOD_CLOSE_LATER_EXCHANGE',
  );
  expect(snapshot(app)).toBe(before);
});

it('w_xt_fbwh：40位汇率在正负半分两侧精确四舍五入', async () => {
  const { account, data } = await setup();
  const api = call(app);
  for (const [rate, expected] of [
    ['0.0000499999999999999999999999999999999', [0, 0]],
    ['0.00005', [1, 0]],
  ] as const) {
    await api.saveExchangeSettings({ ...data, rates: [{ ...data.rates[0]!, rate }] });
    const p = await api.exchangePreview({ period: 202601 });
    expect(
      p.rows.filter((r) => r.accountId === account.id).map((r) => r.translatedBalance),
    ).toEqual(expected);
  }
});

it('w_pzedit_hlgl_rq：手工编号须明确设置，编号占用时原子失败且可改号重试', async () => {
  const { data } = await setup();
  const api = call(app);
  await app.svc.voucherPolicy.set({ ...(await app.svc.voucherPolicy.get()), numbering: 'manual' });
  let before = snapshot(app);
  expect((await errorData(api.saveExchangeSettings(data))).code).toBe('PERIOD_CLOSE_FX_NUMBER');
  expect(snapshot(app)).toBe(before);
  await api.saveExchangeSettings({ ...data, number: 8 });
  const occupied = await app.svc.vouchers.create({
    voucherTypeId: data.voucherTypeId,
    number: 8,
    date: '2026-01-26',
    lines: [
      { summary: '合成已占用号', accountId: (await app.svc.accounts.require('4001')).id, debit: 1 },
      {
        summary: '合成已占用号',
        accountId: (await app.svc.accounts.require('4103')).id,
        credit: 1,
      },
    ],
  });
  await app.svc.vouchers.changeStatus({ ids: [occupied.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [occupied.id], to: 'posted' });
  const preview = await api.exchangePreview({ period: 202601 });
  before = snapshot(app);
  await expect(
    api.generateExchange({ period: 202601, confirmed: true, previewToken: preview.previewToken }),
  ).rejects.toThrow();
  expect(snapshot(app)).toBe(before);
  await api.saveExchangeSettings({ ...data, number: 9 });
  const result = await generate();
  expect((await app.svc.vouchers.get(result.result.id!))!.number).toBe(9);
});

it('w_pzedit_hlgl_rq / w_zw_fz：汇兑异人审核过账、损益结转、连续结账和年结承接本外币数量辅助余额', async () => {
  const { account } = await setup();
  const api = call(app);
  const { result } = await generate();
  await app.addUser('fx-reviewer');
  const user = await app.svc.db
    .selectFrom('app_user')
    .select('id')
    .where('code', '=', 'fx-reviewer')
    .executeTakeFirstOrThrow();
  const reviewer = createCoreServices({
    ...app.svc.ctx,
    user: (await loadServiceUser(app.svc.db, user.id))!,
  });
  await reviewer.vouchers.changeStatus({ ids: [result.id!], to: 'audited' });
  await api.post({ from: 202601, to: 202601 });
  await api.saveRule({ data: await rule(app) });
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  expect(preview.items[0]!.debit).toBe(500);
  const monthly = await api.generate({
    period: 202601,
    ruleIds: [1],
    confirmed: true,
    previewToken: preview.previewToken,
  });
  await reviewer.vouchers.changeStatus({ ids: monthly.generated.map((v) => v.id), to: 'audited' });
  await api.post({ from: 202601, to: 202601 });
  const range = { from: 202601, to: 202612 };
  const closePreview = await api.closeRangePreview(range);
  await api.closeRange({ ...range, confirmed: true, previewToken: closePreview.previewToken });
  await api.yearEnd({ year: 2026, confirmed: true });
  const next = (await app.svc.opening.list(2027)).filter((r) => r.accountId === account.id);
  expect(next.map((r) => [r.balance, r.fcBalance, r.quantity])).toEqual([
    [72000, 10000, '2'],
    [-36000, -5000, '-1'],
  ]);
  expect(
    next.every((r) => r.ytdDebit === 0 && r.ytdCredit === 0 && r.dimensions.department != null),
  ).toBe(true);
});

it('w_pzedit_hlgl_rq：自动制证后改为手工编号，已生成汇兑仍可核验、重试、异人审核过账及结账', async () => {
  await setup();
  const { result, input } = await generate();
  await app.svc.voucherPolicy.set({ ...(await app.svc.voucherPolicy.get()), numbering: 'manual' });
  const before = snapshot(app);
  await verifyExchangeRuns(app.svc, 202601, 202601);
  expect(await call(app).generateExchange(input)).toMatchObject({ id: result.id, existing: true });
  expect(snapshot(app)).toBe(before);
  await app.addUser('policy-reviewer');
  const user = await app.svc.db
    .selectFrom('app_user')
    .select('id')
    .where('code', '=', 'policy-reviewer')
    .executeTakeFirstOrThrow();
  const reviewer = createCoreServices({
    ...app.svc.ctx,
    user: (await loadServiceUser(app.svc.db, user.id))!,
  });
  await reviewer.vouchers.changeStatus({ ids: [result.id!], to: 'audited' });
  await call(app).post({ from: 202601, to: 202601 });
  await call(app).close({ period: 202601, confirmed: true, allowUntransferredPnl: true });
  expect((await app.svc.periods.require(202601)).status).toBe('closed');
});

it('w_pzedit_hlgl_rq：手工编号切回自动时忽略旧号，撤销重建按当前策略重新分号', async () => {
  const { data } = await setup();
  const api = call(app);
  await app.svc.voucherPolicy.set({ ...(await app.svc.voucherPolicy.get()), numbering: 'manual' });
  await api.saveExchangeSettings({ ...data, number: 9 });
  const manual = await generate();
  expect((await app.svc.vouchers.get(manual.result.id!))!.number).toBe(9);
  await remove();
  await app.svc.voucherPolicy.set({
    ...(await app.svc.voucherPolicy.get()),
    numbering: 'automatic',
  });
  const auto = await generate();
  expect((await app.svc.vouchers.get(auto.result.id!))!.number).toBe(2);
});
