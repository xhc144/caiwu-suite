import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, rule, snapshot, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100 },
        { account: '6001', credit: 100 },
      ],
    },
  ]);
  await call(app).saveRule({ data: await rule(app) });
});
afterEach(async () => app.close());

it('w_zw_ydjz：手工编号结转缺号和重号均回滚，输入可用号后正式生成并幂等恢复', async () => {
  await app.svc.voucherPolicy.set({ ...(await app.svc.voucherPolicy.get()), numbering: 'manual' });
  const api = call(app);
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  expect(preview.numbering).toBe('manual');
  const input = {
    period: 202601,
    ruleIds: [1],
    previewToken: preview.previewToken,
    confirmed: true,
  };
  const before = snapshot(app);
  expect((await errorData(api.generate(input))).code).toBe('VOUCHER_NUMBER_REQUIRED');
  expect(snapshot(app)).toBe(before);
  await expect(api.generate({ ...input, voucherNumbers: { '1': 1 } })).rejects.toThrow();
  expect(snapshot(app)).toBe(before);
  const result = await api.generate({ ...input, voucherNumbers: { '1': 5 } });
  const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
  expect(voucher).toMatchObject({
    number: 5,
    status: 'pending',
    debitTotal: 100,
    creditTotal: 100,
  });
  expect((await api.generate({ ...input, voucherNumbers: { '1': 5 } })).generated).toEqual([
    { id: voucher.id, existing: true },
  ]);
});

it('w_zw_ydjz：编号策略变化使旧预览失效，不沿用旧确认生成', async () => {
  const api = call(app);
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  await app.svc.voucherPolicy.set({ ...(await app.svc.voucherPolicy.get()), numbering: 'manual' });
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.generate({
          period: 202601,
          ruleIds: [1],
          previewToken: preview.previewToken,
          confirmed: true,
          voucherNumbers: { '1': 2 },
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_PREVIEW_CHANGED');
  expect(snapshot(app)).toBe(before);
});

it('w_xt_jzwh：长比例在安全整数半分两侧准确取整，不受共享精度截断影响', async () => {
  const api = call(app);
  await api.removeRule({ id: 1 });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('4001')).id,
    balance: 9007199254740991,
  });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('4104')).id,
    balance: -9007199254740991,
  });
  await api.saveRule({
    data: await rule(app, {
      kind: 'custom',
      sources: [
        {
          accountId: (await app.svc.accounts.require('4001')).id,
          mode: 'balance',
          ratio: '49.999999999999999999999999999999999999999999999999999999999999',
        },
      ],
    }),
  });
  const id = (await api.rules())[0]!.id;
  const preview = await api.preview({ period: 202601, ruleIds: [id] });
  expect(preview.items[0]!.debit).toBe(4503599627370495);
  expect(preview.items[0]!.credit).toBe(4503599627370495);
});
