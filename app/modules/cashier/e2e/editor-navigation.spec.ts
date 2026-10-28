import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook, documents, recordThree } from './scenarios';
import type { Outputs } from '../web/api';

for (const entity of ['account', 'document'] as const) {
  test(`${entity} 非法金额登记到壳：关闭所有、切账的取消和保存均保留，明确放弃才能离开`, async ({
    cashier,
  }) => {
    test.setTimeout(60_000);
    const book = await bankBook(cashier);
    const { page } = cashier;
    const doc = entity === 'document' ? (await recordThree(cashier, book))[0]! : null;
    await page.goto(`/m/cashier/${entity === 'account' ? 'accounts' : 'documents'}`);
    await page
      .getByRole('row', { name: entity === 'account' ? /闭环银行/ : new RegExp(doc!.summary) })
      .getByRole('button', { name: '修改', exact: true })
      .click();
    const drawer = page.getByRole('dialog', {
      name: entity === 'account' ? '修改账户配置' : `修改 ${doc!.number}`,
      exact: true,
    });
    const amount = drawer.getByLabel(entity === 'account' ? '出纳期初（借正贷负）' : '金额', {
      exact: true,
    });
    await amount.fill('abc');
    let writes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /m\.cashier\.(saveAccount|updateDocument)/.test(r.url()))
        writes += 1;
    });
    // 抽屉覆盖壳工具栏；直接触发真实壳按钮，检查共享注册表的离开路径。
    const closeAll = () =>
      page
        .getByRole('button', { name: '关闭所有', exact: true })
        .evaluate((button) => (button as HTMLElement).click());
    await closeAll();
    let confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await expect(
      confirm.getByText(entity === 'account' ? '出纳账户与期初' : '出纳收付单', { exact: true }),
    ).toBeVisible();
    await confirm.getByRole('button', { name: /取\s*消/ }).click();
    await expect(amount).toHaveValue('abc');
    await closeAll();
    confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await confirm.getByRole('button', { name: '保存并继续', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await expect(amount).toHaveValue('abc');
    const switchBook = async () => {
      await page.locator('.cw-header-actions button').last().dispatchEvent('mouseover');
      await page
        .locator('.ant-dropdown:visible')
        .getByRole('menuitem', { name: '切换账套', exact: true })
        .evaluate((item) => (item as HTMLElement).click());
    };
    await switchBook();
    confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await confirm.getByRole('button', { name: /取\s*消/ }).click();
    await expect(amount).toHaveValue('abc');
    await switchBook();
    confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await confirm.getByRole('button', { name: '保存并继续', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await expect(amount).toHaveValue('abc');
    expect(writes).toBe(0);
    if (entity === 'account') {
      const rows = await callApi<Outputs['accounts']>(
        cashier.request,
        'm.cashier.accounts',
        {},
        { token: book.token, method: 'GET' },
      );
      expect(rows[0]).toMatchObject({ opening: 100000, revision: 1 });
    } else {
      expect((await documents(cashier, book)).find((r) => r.id === doc!.id)).toMatchObject({
        amount: doc!.amount,
        revision: 1,
      });
    }
    await closeAll();
    await page
      .getByRole('dialog', { name: '有未保存内容', exact: true })
      .getByRole('button', { name: '放弃修改并继续' })
      .click();
    await expect(drawer).not.toBeVisible();
  });
}
