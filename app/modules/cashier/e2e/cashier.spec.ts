import { loginWithNewBook, callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';

test('出纳：独立账套→账户期初→3笔收付→来源凭证→core过账→手动勾账→余额调节→取消', async ({
  cashier,
}) => {
  const { page, request, withServices } = cashier;
  const { bookId, token } = await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/cashier/accounts');
  await expect(page.getByRole('heading', { name: '出纳账户与期初' })).toBeVisible();
  await page.getByRole('button', { name: '保存启用状态' }).click();
  await expect(page.getByText('出纳已启用：202601；历史数据已保留')).toBeVisible();
  await page.getByRole('button', { name: '新增账户', exact: true }).click();
  const accountDrawer = page.getByRole('dialog', { name: '新增出纳账户' });
  await accountDrawer.getByLabel('账户名称').fill('闭环银行');
  await accountDrawer.getByLabel('关联现金银行科目').fill('100201');
  await page.keyboard.press('Enter');
  await accountDrawer.getByLabel('出纳期初（借正贷负）').fill('1000');
  await accountDrawer.getByRole('button', { name: '保存账户' }).click();
  await expect(accountDrawer).not.toBeVisible();
  await withServices(bookId, async (svc) => {
    const bank = await svc.accounts.require('100201');
    await svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 100000 });
  });
  await page.reload();
  await expect(page.getByRole('row', { name: /闭环银行/ })).toContainText('1,000.00');
  await page.goto('/m/cashier/documents');
  for (const [summary, amount, direction] of [
    ['客户到账', '200', '收款'],
    ['支付手续费', '80', '付款'],
    ['利息到账', '25', '收款'],
  ] as const) {
    await page.getByRole('button', { name: '新增收付单' }).click();
    const drawer = page.getByRole('dialog', { name: '新增收付单' });
    await drawer.getByLabel('出纳账户').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('日期', { exact: true }).fill('2026-01-10');
    await drawer.getByLabel('摘要', { exact: true }).fill(summary);
    await drawer.getByLabel('收付方向').click();
    if (direction === '付款') await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('金额', { exact: true }).fill(amount);
    await drawer.getByLabel('对方科目', { exact: true }).fill('6603');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('现金流量项目', { exact: true }).fill('CF01');
    await page.keyboard.press('Enter');
    await drawer.getByRole('button', { name: '保存收付单' }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(summary) })).toBeVisible();
  }
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
  await page.getByRole('button', { name: '生成凭证预览' }).click();
  const generate = page.getByRole('dialog', { name: '凭证生成预览' });
  await generate.getByRole('button', { name: '预览分录' }).click();
  await expect(generate.getByRole('row', { name: /银行存款/ })).toHaveCount(3);
  await generate.getByRole('button', { name: '确认生成待审核凭证' }).click();
  await expect(generate).not.toBeVisible();
  await expect(page.getByText('来源锁定', { exact: true })).toHaveCount(3);
  const docs = await callApi<{ id: number; revision: number; voucherId: number }[]>(
    request,
    'm.cashier.documents',
    {},
    { token, method: 'GET' },
  );
  const ids = [...new Set(docs.map((d) => d.voucherId))];
  expect(ids).toHaveLength(3);
  await withServices(bookId, async (svc) => {
    await svc.vouchers.changeStatus({ ids, to: 'audited' });
    await svc.vouchers.changeStatus({ ids, to: 'posted' });
  });
  await page.goto('/m/cashier/reconcile');
  await expect(page.getByRole('heading', { name: '和账务对账', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新财务分录' }).click();
  await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,290.00');
  await expect(page.getByText('期初差额：0.00；调节后差额：0.00')).toBeVisible();
  const selectAll = page.getByRole('checkbox', { name: 'Select all', exact: true });
  await expect(selectAll).toHaveCount(2);
  await selectAll.nth(0).check();
  await selectAll.nth(1).check();
  await page.getByRole('button', { name: '确认手动勾账' }).click();
  const confirm = page.getByRole('dialog', { name: '确认手动等额勾账' });
  await confirm.getByLabel('确认文字').fill('勾账');
  await confirm.getByRole('button', { name: '确定' }).click();
  await expect(page.getByRole('button', { name: '取消勾账', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,145.00');
  await expect(page.getByText('出纳未达项')).toBeVisible();
  const matched = await callApi<{
    adjustment: { cashOutstanding: number; coreOutstanding: number; difference: number };
  }>(
    request,
    'm.cashier.reconcile',
    { accountId: 1, cutoff: '2026-01-31' },
    { token, method: 'GET' },
  );
  expect(matched.adjustment).toMatchObject({
    cashOutstanding: 0,
    coreOutstanding: 0,
    difference: 0,
  });
  await page.getByRole('button', { name: '取消勾账', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: '取消勾账组 1' });
  await cancel.getByLabel('确认文字').fill('取消勾账');
  await cancel.getByRole('button', { name: '确定' }).click();
  await expect(page.getByRole('button', { name: '取消勾账', exact: true })).not.toBeVisible();
  const restored = await callApi<{
    adjustment: {
      cashBalance: number;
      coreBalance: number;
      cashOutstanding: number;
      coreOutstanding: number;
      difference: number;
    };
  }>(
    request,
    'm.cashier.reconcile',
    { accountId: 1, cutoff: '2026-01-31' },
    { token, method: 'GET' },
  );
  expect(restored.adjustment).toMatchObject({
    cashBalance: 114500,
    coreBalance: 114500,
    cashOutstanding: 14500,
    coreOutstanding: 14500,
    difference: 0,
  });
  // 跨模块只检查导航 URL，不以目标模块作为前置。
  await page.getByRole('button', { name: '记-0001', exact: true }).click();
  await expect(page).toHaveURL(/\/m\/voucher-entry\/edit\?id=/);
});
