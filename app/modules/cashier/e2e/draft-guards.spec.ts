import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook, documents } from './scenarios';
import type { Outputs } from '../web/api';
import type { CashierTables } from '../server/migrations';

for (const invalid of ['12..34', 'abc']) {
  test(`w_cn_lr_qc 非法期初 ${invalid}：按钮、快捷键和失焦均不保存旧金额`, async ({ cashier }) => {
    const book = await bankBook(cashier);
    const { page } = cashier;
    await page.goto('/m/cashier/accounts');
    await page.getByRole('button', { name: '新增账户', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增出纳账户' });
    await drawer.getByLabel('账户名称').fill('非法草稿账户');
    await drawer.getByLabel('关联现金银行科目').fill('1001');
    await page.keyboard.press('Enter');
    const amount = drawer.getByLabel('出纳期初（借正贷负）');
    await amount.fill('12.34');
    await amount.fill(invalid);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('m.cashier.saveAccount')) writes.push(r.url());
    });
    await page.keyboard.press('Control+s');
    await amount.press('Enter');
    await amount.press('Tab');
    await drawer.getByRole('button', { name: '保存账户', exact: true }).click();
    await page.waitForTimeout(350);
    expect.soft(writes).toHaveLength(0);
    const rows = await callApi<Outputs['accounts']>(
      cashier.request,
      'm.cashier.accounts',
      {},
      {
        token: book.token,
        method: 'GET',
      },
    );
    expect.soft(rows.map((r) => [r.name, r.opening])).toEqual([['闭环银行', 100000]]);
    await cashier.withServices(book.bookId, async (svc) => {
      const db = svc.db.withTables<CashierTables>();
      expect(
        await db.selectFrom('cashier_opening').select(['account_id', 'balance']).execute(),
      ).toEqual([{ account_id: book.accountId, balance: 100000 }]);
    });
    await expect(drawer).toBeVisible();
    await expect(amount).toHaveValue(invalid);
  });

  test(`w_cn_lr_add 非法金额 ${invalid}：按钮、快捷键和失焦均不保存旧金额`, async ({ cashier }) => {
    const book = await bankBook(cashier);
    const { page } = cashier;
    await page.goto('/m/cashier/documents');
    await page.getByRole('button', { name: '新增收付单', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增收付单' });
    await drawer.getByLabel('出纳账户', { exact: true }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('摘要', { exact: true }).fill('非法草稿收款');
    await drawer.getByLabel('现金流量项目', { exact: true }).fill('CF01');
    await page.keyboard.press('Enter');
    const amount = drawer.getByLabel('金额', { exact: true });
    await amount.fill('12.34');
    await amount.fill(invalid);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('m.cashier.createDocument'))
        writes.push(r.url());
    });
    await page.keyboard.press('Control+s');
    await amount.press('Enter');
    await amount.press('Tab');
    await drawer.getByRole('button', { name: '保存收付单', exact: true }).click();
    await page.waitForTimeout(350);
    expect.soft(writes).toHaveLength(0);
    expect.soft(await documents(cashier, book)).toEqual([]);
    await cashier.withServices(book.bookId, async (svc) => {
      expect(
        await svc.db
          .withTables<CashierTables>()
          .selectFrom('cashier_document')
          .selectAll()
          .execute(),
      ).toEqual([]);
    });
    await expect(drawer).toBeVisible();
    await expect(amount).toHaveValue(invalid);
  });
}
