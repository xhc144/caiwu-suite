import { randomUUID } from 'node:crypto';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { postedBook, reconciliation, documents } from './scenarios';

const feedback = { timeout: 5000 };
test('w_cn_dz 自动建议真实三单逐对确认，余额调节恢复零未达', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  await page.goto('/m/cashier/reconcile');
  await page.getByRole('button', { name: '预览自动勾账建议', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '自动勾账建议', exact: true });
  await expect(drawer.getByText(/已选择 3 对/)).toBeVisible();
  await expect(drawer.getByText('双方唯一', { exact: true })).toHaveCount(3);
  expect((await reconciliation(cashier, book)).groups).toEqual([]);
  await drawer.getByRole('button', { name: '确认所选匹配', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认自动勾账', exact: true });
  await expect(confirm.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
  await confirm.getByLabel('确认文字').fill('自动勾账');
  await test.step(
    '自动勾账5秒内真实提交全部配对',
    async () => {
      await confirm.getByRole('button', { name: '确定', exact: true }).click();
      await expect(drawer).not.toBeVisible();
      await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,145.00');
      await expect(page.getByRole('button', { name: '取消勾账', exact: true })).toHaveCount(3);
    },
    feedback,
  );
  const after = await reconciliation(cashier, book);
  expect(after.groups).toHaveLength(3);
  expect(after.groups.every((g) => g.valid)).toBe(true);
  expect(after.adjustment).toMatchObject({ cashOutstanding: 0, coreOutstanding: 0, difference: 0 });
});

test('w_cn_dz 重复金额候选不默认确认，用户选择后每条财务分录只占用一次', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  const oppositeAccountId = await cashier.withServices(
    book.bookId,
    async (svc) => (await svc.accounts.require('6603')).id,
  );
  await callApi(
    cashier.request,
    'm.cashier.createDocument',
    {
      accountId: book.accountId,
      period: 202601,
      date: '2026-01-11',
      summary: '相同金额收款',
      direction: 'receipt',
      amount: 20000,
      oppositeAccountId,
      dimensions: { cashflow: book.cashflow },
      requestKey: randomUUID(),
    },
    { token: book.token },
  );
  const rows = await documents(cashier, book);
  const d = rows.find((d) => d.summary === '相同金额收款')!;
  await callApi(
    cashier.request,
    'm.cashier.generate',
    {
      documents: [{ id: d.id, revision: d.revision }],
      date: '2026-01-11',
      voucherTypeId: book.voucherTypeId,
      mode: 'individual',
      requestKey: randomUUID(),
    },
    { token: book.token },
  );
  const voucherId = (await documents(cashier, book)).find((r) => r.id === d.id)!.voucherId!;
  await cashier.withServices(book.bookId, async (svc) => {
    await svc.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [voucherId], to: 'posted' });
  });
  await page.goto('/m/cashier/reconcile');
  await page.getByRole('button', { name: '预览自动勾账建议', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '自动勾账建议', exact: true });
  await expect(drawer.getByText(/已选择 2 对/)).toBeVisible();
  await expect(drawer.getByText('重复金额，需核对', { exact: true })).toHaveCount(2);
  for (const number of ['CN-000001', d.number]) {
    await drawer.getByLabel(`匹配 ${number}`, { exact: true }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await expect(drawer.getByText(/已选择 4 对/)).toBeVisible();
  await drawer.getByRole('button', { name: '确认所选匹配', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认自动勾账', exact: true });
  await confirm.getByLabel('确认文字').fill('自动勾账');
  await test.step(
    '人工消歧后5秒内提交四个独立勾账组',
    async () => {
      await confirm.getByRole('button', { name: '确定', exact: true }).click();
      await expect(page.getByRole('button', { name: '取消勾账', exact: true })).toHaveCount(4);
    },
    feedback,
  );
  const after = await reconciliation(cashier, book);
  expect(after.groups).toHaveLength(4);
  expect(new Set(after.entries.map((e) => e.matchId)).size).toBe(4);
  expect(after.adjustment.cashOutstanding).toBe(0);
  expect(after.adjustment.coreOutstanding).toBe(0);
});
