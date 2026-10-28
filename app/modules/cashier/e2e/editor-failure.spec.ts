import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook, documents, recordThree } from './scenarios';
import type { Outputs } from '../web/api';

for (const entity of ['account', 'document'] as const) {
  test(`${entity} 真实版本冲突：失败保留输入，关闭保存失败仍不离开`, async ({ cashier }) => {
    test.setTimeout(60_000);
    const book = await bankBook(cashier);
    const { page, request } = cashier;
    const doc = entity === 'document' ? (await recordThree(cashier, book))[0]! : null;
    const account = (
      await callApi<Outputs['accounts']>(
        request,
        'm.cashier.accounts',
        {},
        { token: book.token, method: 'GET' },
      )
    )[0]!;
    await page.goto(`/m/cashier/${entity === 'account' ? 'accounts' : 'documents'}`);
    await page
      .getByRole('row', { name: entity === 'account' ? /闭环银行/ : new RegExp(doc!.summary) })
      .getByRole('button', { name: '修改', exact: true })
      .click();
    const drawer = page.getByRole('dialog', {
      name: entity === 'account' ? '修改账户配置' : `修改 ${doc!.number}`,
      exact: true,
    });
    const text = drawer.getByLabel(entity === 'account' ? '账户名称' : '摘要', { exact: true });
    await text.fill('本地未保存修改');
    if (entity === 'account') {
      await callApi(
        request,
        'm.cashier.saveAccount',
        {
          data: { ...account, name: '其他窗口已保存' },
          edit: { id: account.id, revision: account.revision },
        },
        { token: book.token },
      );
    } else {
      await callApi(
        request,
        'm.cashier.updateDocument',
        { id: doc!.id, revision: doc!.revision, data: { ...doc!, summary: '其他窗口已保存' } },
        { token: book.token },
      );
    }
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r
          .url()
          .includes(entity === 'account' ? 'm.cashier.saveAccount' : 'm.cashier.updateDocument'),
    );
    await page.keyboard.press('Control+s');
    expect((await response).ok()).toBe(false);
    await expect(text).toHaveValue('本地未保存修改');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await confirm.getByRole('button', { name: '保存并关闭' }).click();
    await expect(drawer).toBeVisible();
    await expect(text).toHaveValue('本地未保存修改');
    if (entity === 'account') {
      const stored = await callApi<Outputs['accounts']>(
        request,
        'm.cashier.accounts',
        {},
        { token: book.token, method: 'GET' },
      );
      expect(stored[0]).toMatchObject({ name: '其他窗口已保存', opening: 100000, revision: 2 });
    } else {
      expect((await documents(cashier, book)).find((r) => r.id === doc!.id)).toMatchObject({
        summary: '其他窗口已保存',
        amount: doc!.amount,
        revision: 2,
      });
    }
  });
}

test('w_cn_lr_qc 新开账户未编辑可直接关闭，必填空额不请求，零期初可保存', async ({ cashier }) => {
  const book = await bankBook(cashier);
  const { page } = cashier;
  await page.goto('/m/cashier/accounts');
  await page.getByRole('button', { name: '新增账户', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '新增出纳账户' });
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: '有未保存内容' })).not.toBeVisible();
  await page.getByRole('button', { name: '新增账户', exact: true }).click();
  drawer = page.getByRole('dialog', { name: '新增出纳账户' });
  await drawer.getByLabel('账户名称').fill('零期初账户');
  await drawer.getByLabel('关联现金银行科目').fill('1001');
  await page.keyboard.press('Enter');
  const amount = drawer.getByLabel('出纳期初（借正贷负）');
  await amount.fill('');
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('m.cashier.saveAccount')) writes += 1;
  });
  await page.keyboard.press('Control+s');
  await drawer.getByRole('button', { name: '保存账户', exact: true }).click();
  await page.waitForTimeout(300);
  expect(writes).toBe(0);
  await expect(amount).toHaveValue('');
  await amount.fill('0');
  await page.keyboard.press('Control+s');
  await expect(drawer).not.toBeVisible();
  const stored = await callApi<Outputs['accounts']>(
    cashier.request,
    'm.cashier.accounts',
    {},
    { token: book.token, method: 'GET' },
  );
  expect(stored.find((r) => r.name === '零期初账户')).toMatchObject({ opening: 0 });
});
