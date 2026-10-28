import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

test('w_zjjs：购入当月零折旧批次无需凭证可月结，非零未制证仍阻止月结', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, name, input, { token, method: 'POST' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, name, input, { token, method: 'GET' });
  const accounts = await get<{ id: number; code: string }[]>('core.accounts.list');
  const account = (code: string) => accounts.find((row) => row.code === code)!.id;
  await post('m.opening.save', {
    year: 2026,
    changes: [{ data: { year: 2026, accountId: account('1001'), balance: 0 } }],
  });
  const categoryId = await post<number>('m.fixed-assets.saveMaster', {
    data: { kind: 'category', code: '01', name: '设备', accountId: account('1601') },
  });
  const purposeId = await post<number>('m.fixed-assets.saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用', accountId: account('6602') },
  });
  const statusId = await post<number>('m.fixed-assets.saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  const departments = await get<{ id: number }[]>('core.dimensions.items', { type: 'department' });
  await post('m.fixed-assets.save', {
    data: {
      code: 'ZERO-MONTH',
      name: '购入当月零折旧设备',
      categoryId,
      purposeId,
      statusId,
      departmentId: departments[0]!.id,
      acquired: '2026-01-01',
      useDate: '2026-01-01',
      original: 600000,
      rate: '0',
      method: '1',
      lifeMonths: 60,
    },
  });
  const january = await get<{ token: string; total: number }>('m.fixed-assets.preview', {
    period: 202601,
  });
  expect(january.total).toBe(0);
  const zeroId = await post<number>('m.fixed-assets.depreciate', {
    period: 202601,
    token: january.token,
    confirm: true,
  });
  expect(await get('m.fixed-assets.batches')).toMatchObject([
    { id: zeroId, total: 0, requiresVoucher: false, voucher_id: null },
  ]);
  await page.goto('/m/fixed-assets/depreciation');
  const zero = page.getByRole('row', { name: /202601/ });
  await expect(zero).toContainText('本月无需制证');
  await expect(zero.getByRole('button', { name: '凭证预览/生成' })).toHaveCount(0);
  await expect(
    post('m.period-close.close', { period: 202601, confirmed: true }),
  ).resolves.toMatchObject({ message: expect.stringContaining('已结账') });
  const february = await get<{ token: string; total: number }>('m.fixed-assets.preview', {
    period: 202602,
  });
  expect(february.total).toBe(10000);
  await post('m.fixed-assets.depreciate', { period: 202602, token: february.token, confirm: true });
  await expect(post('m.period-close.close', { period: 202602, confirmed: true })).rejects.toThrow(
    /未制证折旧批次/,
  );
  expect(await get<{ period: number; status: string }[]>('core.periods.list')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ period: 202601, status: 'closed' }),
      expect.objectContaining({ period: 202602, status: 'open' }),
    ]),
  );
});
