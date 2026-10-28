import { callApi } from '@caiwu/testkit/e2e';
import { test, expect, type CashierFixture } from './fixture';
import { bankBook, documents, type BankBook } from './scenarios';
import type { Outputs } from '../web/api';

async function foreignAccount(cashier: CashierFixture, book: BankBook) {
  const id = await cashier.withServices(
    book.bookId,
    async (svc) => (await svc.accounts.require('100202')).id,
  );
  return callApi<{ id: number }>(
    cashier.request,
    'm.cashier.saveAccount',
    {
      data: {
        name: '美元草稿银行',
        coreAccountId: id,
        currency: 'USD',
        opening: 0,
        foreignOpening: 0,
      },
    },
    { token: book.token },
  );
}

for (const invalid of ['12..34', 'abc']) {
  test(`w_cn_lr_qc 原币期初 ${invalid}：重挂载保留原文，所有入口阻止旧金额`, async ({
    cashier,
  }) => {
    const book = await bankBook(cashier);
    const { page } = cashier;
    await page.goto('/m/cashier/accounts');
    await page.getByRole('button', { name: '新增账户', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增出纳账户' });
    await drawer.getByLabel('账户名称').fill('非法原币期初');
    await drawer.getByLabel('关联现金银行科目').fill('100202');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('出纳期初（借正贷负）').fill('12.34');
    const input = drawer.getByLabel('原币期初（借正贷负）');
    await input.fill('12.34');
    await input.fill(invalid);
    await drawer.getByLabel('币种', { exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('CNY 人民币', { exact: true })
      .click();
    await expect(input).not.toBeVisible();
    await drawer.getByLabel('币种', { exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText('USD 美元', { exact: true })
      .click();
    await expect(input).toHaveValue(invalid);
    let writes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('m.cashier.saveAccount')) writes += 1;
    });
    await page.keyboard.press('Control+s');
    await input.press('Tab');
    await drawer.getByRole('button', { name: '保存账户', exact: true }).click();
    await page.waitForTimeout(300);
    expect(writes).toBe(0);
    const rows = await callApi<Outputs['accounts']>(
      cashier.request,
      'm.cashier.accounts',
      {},
      { token: book.token, method: 'GET' },
    );
    expect(rows.map((r) => [r.name, r.opening, r.foreignOpening])).toEqual([
      ['闭环银行', 100000, null],
    ]);
    await input.fill('0');
    await drawer.getByLabel('出纳期初（借正贷负）').fill('0');
    await page.keyboard.press('Control+s');
    await expect(drawer).not.toBeVisible();
    const zero = await callApi<Outputs['accounts']>(
      cashier.request,
      'm.cashier.accounts',
      {},
      { token: book.token, method: 'GET' },
    );
    expect(zero.find((r) => r.name === '非法原币期初')).toMatchObject({
      opening: 0,
      foreignOpening: 0,
    });
  });

  for (const field of ['foreignAmount', 'amount'] as const) {
    test(`w_cn_lr_add ${field} ${invalid}：汇率按钮不覆盖非法草稿，保存无请求`, async ({
      cashier,
    }) => {
      const book = await bankBook(cashier);
      await foreignAccount(cashier, book);
      const { page } = cashier;
      await page.goto('/m/cashier/documents');
      await page.getByRole('button', { name: '新增收付单', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: '新增收付单' });
      await drawer.getByLabel('出纳账户', { exact: true }).click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByText('美元草稿银行', { exact: true })
        .click();
      await drawer.getByLabel('摘要', { exact: true }).fill('原币草稿');
      await drawer.getByLabel('现金流量项目', { exact: true }).fill('CF01');
      await page.keyboard.press('Enter');
      await drawer.getByLabel('原币金额（USD）', { exact: true }).fill('12.34');
      await drawer.getByLabel('汇率（原币折本位币）').fill('1');
      const input = drawer.getByLabel(field === 'amount' ? '折合本位币金额' : '原币金额（USD）', {
        exact: true,
      });
      await expect(drawer.getByLabel('折合本位币金额')).toHaveValue('12.34');
      await input.fill(invalid);
      let writes = 0;
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().includes('m.cashier.createDocument')) writes += 1;
      });
      await drawer.getByRole('button', { name: /使用已设汇率 7.1/ }).click();
      await expect(input).toHaveValue(invalid);
      await page.keyboard.press('Control+s');
      await input.press('Tab');
      await drawer.getByRole('button', { name: '保存收付单', exact: true }).click();
      await page.waitForTimeout(300);
      expect(writes).toBe(0);
      expect(await documents(cashier, book)).toEqual([]);
      await expect(input).toHaveValue(invalid);
    });
  }

  test(`支票管理 签发金额 ${invalid}：不进入确认，不发送请求，不改支票`, async ({ cashier }) => {
    const book = await bankBook(cashier);
    await callApi(
      cashier.request,
      'm.cashier.receiveCheck',
      { accountId: book.accountId, number: 'DRAFT-CHECK', receivedDate: '2026-01-02' },
      { token: book.token },
    );
    const { page } = cashier;
    await page.goto('/m/cashier/checks');
    await page
      .getByRole('row', { name: /DRAFT-CHECK/ })
      .getByRole('button', { name: '签发', exact: true })
      .click();
    const drawer = page.getByRole('dialog', { name: '签发支票', exact: true });
    await drawer.getByLabel('办理日期', { exact: true }).fill('2026-01-03');
    await drawer.getByLabel('收款人').fill('草稿收款人');
    const amount = drawer.getByLabel('签发金额');
    await amount.fill('12.34');
    await amount.fill(invalid);
    let writes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('m.cashier.issueCheck')) writes += 1;
    });
    await page.keyboard.press('Control+s');
    await amount.press('Tab');
    await drawer.getByRole('button', { name: '保存支票登记', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '签发支票 DRAFT-CHECK', exact: true }),
    ).not.toBeVisible();
    expect(writes).toBe(0);
    const checks = await callApi<Outputs['checks']>(
      cashier.request,
      'm.cashier.checks',
      {},
      { token: book.token, method: 'GET' },
    );
    expect(checks[0]).toMatchObject({ state: 'received', amount: null, revision: 1 });
    await expect(amount).toHaveValue(invalid);
  });
}

test('w_cn_ll 最小与最大金额非法原文阻止查询，重置清除同数值草稿', async ({ cashier }) => {
  await bankBook(cashier);
  const { page } = cashier;
  await page.goto('/m/cashier/documents');
  await expect(page.getByRole('heading', { name: '出纳收付单', exact: true })).toBeVisible();
  for (const label of ['最小金额', '最大金额']) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill('12.34');
    await input.fill('abc');
    await page.getByRole('button', { name: /查询$/ }).click();
    await expect(input).toHaveValue('abc');
    expect(new URL(page.url()).searchParams.get(label === '最小金额' ? 'min' : 'max')).toBeNull();
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(input).toHaveValue('');
  }
});
