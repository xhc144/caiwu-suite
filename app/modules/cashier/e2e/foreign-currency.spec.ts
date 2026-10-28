import { loginWithNewBook, callApi } from '@caiwu/testkit/e2e';
import type { inferRouterOutputs } from '@trpc/server';
import type { CashierRouter } from '../server/router';
import { test, expect } from './fixture';

type Outputs = inferRouterOutputs<CashierRouter>;

test('外币页面闭环：建美元账户、录收付款、生成过账、双币自动勾账', async ({ cashier }) => {
  const { page, request, withServices } = cashier;
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/cashier/accounts');
  await page.getByRole('button', { name: '保存启用状态' }).click();
  await expect(page.getByText('出纳已启用：202601；历史数据已保留')).toBeVisible();
  await page.getByRole('button', { name: '新增账户', exact: true }).click();
  const accountDrawer = page.getByRole('dialog', { name: '新增出纳账户' });
  await accountDrawer.getByLabel('账户名称').fill('合成美元银行');
  await accountDrawer.getByLabel('关联现金银行科目').fill('100202');
  await page.keyboard.press('Enter');
  await expect(accountDrawer.getByLabel('原币期初（借正贷负）')).toBeVisible();
  await accountDrawer.getByLabel('出纳期初（借正贷负）').fill('710');
  await accountDrawer.getByLabel('原币期初（借正贷负）').fill('100');
  await accountDrawer.getByRole('button', { name: '保存账户' }).click();
  await expect(accountDrawer).not.toBeVisible();
  const accounts = await callApi<Outputs['accounts']>(
    request,
    'm.cashier.accounts',
    {},
    { token: book.token, method: 'GET' },
  );
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ currency: 'USD', opening: 71000, foreignOpening: 10000 });
  const accountId = accounts[0]!.id;
  await withServices(book.bookId, async (svc) => {
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('100202')).id,
      currency: 'USD',
      balance: 71000,
      fcBalance: 10000,
    });
  });
  await page.goto('/m/cashier/documents');
  for (const row of [
    { summary: '合成美元到账', direction: 'receipt', foreign: '20', base: '142.00' },
    { summary: '合成美元付费', direction: 'payment', foreign: '5', base: '35.50' },
  ]) {
    await page.getByRole('button', { name: '新增收付单' }).click();
    const drawer = page.getByRole('dialog', { name: '新增收付单' });
    await drawer.getByLabel('出纳账户', { exact: true }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('日期', { exact: true }).fill('2026-01-10');
    await drawer.getByLabel('摘要', { exact: true }).fill(row.summary);
    await drawer.getByLabel('收付方向').click();
    if (row.direction === 'payment') await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('原币金额（USD）', { exact: true }).fill(row.foreign);
    await drawer.getByRole('button', { name: /使用已设汇率 7.1/ }).click();
    await expect(drawer.getByLabel('折合本位币金额')).toHaveValue(row.base);
    await drawer.getByLabel('对方科目', { exact: true }).fill('6603');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('现金流量项目', { exact: true }).fill('CF01');
    await page.keyboard.press('Enter');
    await drawer.getByRole('button', { name: '保存收付单' }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(row.summary) })).toContainText(row.base);
  }
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
  await page.getByRole('button', { name: '生成凭证预览' }).click();
  const generate = page.getByRole('dialog', { name: '凭证生成预览' });
  await generate.getByRole('button', { name: '预览分录' }).click();
  await expect(generate.getByRole('row', { name: /USD/ })).toHaveCount(2);
  await generate.getByRole('button', { name: '确认生成待审核凭证' }).click();
  await expect(generate).not.toBeVisible();
  const docs = await callApi<Outputs['documents']>(
    request,
    'm.cashier.documents',
    { accountId },
    { token: book.token, method: 'GET' },
  );
  expect(docs.map((d) => [d.direction, d.amount, d.foreignAmount, d.exchangeRate])).toEqual([
    ['receipt', 14200, 2000, '7.1'],
    ['payment', 3550, 500, '7.1'],
  ]);
  await withServices(book.bookId, async (svc) => {
    const ids = [...new Set(docs.map((d) => d.voucherId!))];
    for (const id of ids) {
      const voucher = (await svc.vouchers.get(id))!;
      expect(
        voucher.lines.some(
          (l) => l.currency === 'USD' && l.exchangeRate === '7.1' && l.fcAmount != null,
        ),
      ).toBe(true);
    }
    await svc.vouchers.changeStatus({ ids, to: 'audited' });
    await svc.vouchers.changeStatus({ ids, to: 'posted' });
  });
  await page.goto('/m/cashier/reconcile');
  await page.getByRole('button', { name: '预览自动勾账建议' }).click();
  const suggestions = page.getByRole('dialog', { name: '自动勾账建议' });
  await expect(suggestions.getByText(/已选择 2 对/)).toBeVisible();
  await suggestions.getByRole('button', { name: '确认所选匹配' }).click();
  const confirm = page.getByRole('dialog', { name: '确认自动勾账', exact: true });
  await confirm.getByLabel('确认文字').fill('自动勾账');
  await confirm.getByRole('button', { name: '确定', exact: true }).click();
  await expect(suggestions).not.toBeVisible();
  const state = await callApi<Outputs['reconcile']>(
    request,
    'm.cashier.reconcile',
    { accountId, cutoff: '2026-01-31' },
    { token: book.token, method: 'GET' },
  );
  expect(state.groups).toHaveLength(2);
  expect(state.groups.every((g) => g.valid)).toBe(true);
  expect(state.adjustment).toMatchObject({ cashBalance: 81650, coreBalance: 81650, difference: 0 });
  expect(state.foreignAdjustment).toMatchObject({
    cashBalance: 11500,
    coreBalance: 11500,
    cashOutstanding: 0,
    coreOutstanding: 0,
    difference: 0,
  });
  await expect(page.getByText('原币余额调节表（USD）', { exact: true })).toBeVisible();
});
