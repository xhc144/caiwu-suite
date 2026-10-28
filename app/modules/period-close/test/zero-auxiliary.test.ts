import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, generateAll, rule, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());

async function foreign(code: string, balance: number) {
  const account = await app.svc.accounts.create(
    {
      code,
      name: `外币数量损益${code}`,
      categoryId: 'pnl',
      currency: 'USD',
      quantityUnit: '件',
      dimensions: [{ type: 'department', required: true }],
    },
    app.book.codeScheme,
  );
  const department = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  await app.svc.opening.upsert({
    year: 2026,
    accountId: account.id,
    currency: 'USD',
    dimensions: { department },
    balance: 0,
    fcBalance: balance,
    quantity: balance > 0 ? '2.5' : '-1.25',
  });
  return account;
}

it.each([100, -100])(
  'w_zw_ydjz：本币为零的外币数量余额 %i 随真实分录结转，原侧保存且过账后清零',
  async (balance) => {
    const account = await foreign('6999', balance);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 710 },
          { account: '6001', credit: 710 },
        ],
      },
    ]);
    const api = call(app);
    await api.saveRule({ data: await rule(app) });
    const { result } = await generateAll(app);
    const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
    expect(voucher.debitTotal).toBe(710);
    expect(voucher.creditTotal).toBe(710);
    const line = voucher.lines.find((l) => l.accountId === account.id)!;
    expect(line).toMatchObject({
      debit: 0,
      credit: 0,
      fcAmount: 100,
      entrySide: balance > 0 ? 'credit' : 'debit',
      quantity: balance > 0 ? '2.5' : '1.25',
      exchangeRate: '7.1',
    });
    await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await api.post({ from: 202601, to: 202601 });
    expect((await api.check({ period: 202601 })).pnl).toEqual([]);
    expect((await api.preview({ period: 202601, ruleIds: [1] })).items[0]!.existingVoucherId).toBe(
      voucher.id,
    );
  },
);

it('w_zw_ydjz：两行零本币辅助调整可以正式保存且不会被当作空凭证', async () => {
  const debit = await foreign('6998', 100);
  const credit = await foreign('6999', -100);
  const api = call(app);
  await api.saveRule({ data: await rule(app) });
  const { result, preview } = await generateAll(app);
  expect(preview.items[0]!.zero).toBe(false);
  const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
  expect(voucher.lines).toHaveLength(2);
  expect(voucher).toMatchObject({ debitTotal: 0, creditTotal: 0, status: 'pending' });
  expect(voucher.lines.find((l) => l.accountId === debit.id)).toMatchObject({
    entrySide: 'credit',
    fcAmount: 100,
  });
  expect(voucher.lines.find((l) => l.accountId === credit.id)).toMatchObject({
    entrySide: 'debit',
    fcAmount: 100,
  });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await api.post({ from: 202601, to: 202601 });
  expect((await api.check({ period: 202601 })).pnl).toEqual([]);
});
