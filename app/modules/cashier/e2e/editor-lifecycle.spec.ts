import { callApi } from '@caiwu/testkit/e2e';
import { test, expect, type CashierFixture } from './fixture';
import { bankBook, documents, type BankBook } from './scenarios';
import type { Outputs } from '../web/api';

async function openEditor(cashier: CashierFixture, entity: 'account' | 'document') {
  const { page } = cashier;
  if (entity === 'account') {
    await page.goto('/m/cashier/accounts');
    await page.getByRole('button', { name: '新增账户', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增出纳账户' });
    await drawer.getByLabel('账户名称').fill('发送时账户');
    await drawer.getByLabel('关联现金银行科目').fill('1001');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('出纳期初（借正贷负）').fill('12.34');
    return {
      drawer,
      amount: drawer.getByLabel('出纳期初（借正贷负）'),
      text: drawer.getByLabel('账户名称'),
      save: '保存账户',
      endpoint: 'saveAccount',
    };
  }
  await page.goto('/m/cashier/documents');
  await page.getByRole('button', { name: '新增收付单', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增收付单' });
  await drawer.getByLabel('出纳账户', { exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('摘要', { exact: true }).fill('发送时收款');
  await drawer.getByLabel('现金流量项目', { exact: true }).fill('CF01');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('金额', { exact: true }).fill('12.34');
  return {
    drawer,
    amount: drawer.getByLabel('金额', { exact: true }),
    text: drawer.getByLabel('摘要', { exact: true }),
    save: '保存收付单',
    endpoint: 'createDocument',
  };
}

async function rows(cashier: CashierFixture, book: BankBook, entity: 'account' | 'document') {
  if (entity === 'document')
    return (await documents(cashier, book)).map((r) => [r.id, r.summary, r.amount, r.revision]);
  return (
    await callApi<Outputs['accounts']>(
      cashier.request,
      'm.cashier.accounts',
      {},
      { token: book.token, method: 'GET' },
    )
  )
    .filter((r) => r.id !== book.accountId)
    .map((r) => [r.id, r.name, r.opening, r.revision]);
}

for (const entity of ['account', 'document'] as const) {
  test(`${entity} 保存期间继续编辑：合并重复提交、关闭不丢草稿、再次保存更新同一记录`, async ({
    cashier,
  }) => {
    test.setTimeout(60_000);
    const book = await bankBook(cashier);
    const { page } = cashier;
    const editor = await openEditor(cashier, entity);
    const release = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    let writes = 0;
    await page.route(`**/trpc/m.cashier.${editor.endpoint}*`, async (route) => {
      writes += 1;
      const response = await route.fetch();
      persisted.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    try {
      await editor.drawer.getByRole('button', { name: editor.save, exact: true }).click();
      await persisted.promise;
      await page.keyboard.press('Control+s');
      await editor.text.fill('保存期间的新内容');
      await editor.amount.fill('abc');
      await page.keyboard.press('Control+s');
      await editor.drawer.getByRole('button', { name: '取消', exact: true }).click();
      await expect(editor.drawer).toBeVisible();
      expect(writes).toBe(1);
      release.resolve();
      await expect(
        editor.drawer.getByText('先前内容已保存，保存期间的新修改仍未保存。'),
      ).toBeVisible();
      await expect(editor.amount).toHaveValue('abc');
      const saved = await rows(cashier, book, entity);
      expect(saved).toHaveLength(1);
      expect(saved[0]?.slice(1)).toEqual([
        entity === 'account' ? '发送时账户' : '发送时收款',
        1234,
        1,
      ]);
      await page.keyboard.press('Control+s');
      await expect(editor.amount).toHaveAttribute('aria-invalid', 'true');
      await editor.amount.fill('12.35');
      await page.keyboard.press('Control+s');
      await expect(editor.drawer).not.toBeVisible();
      expect(await rows(cashier, book, entity)).toEqual([
        [saved[0]![0], '保存期间的新内容', 1235, 2],
      ]);
      expect(writes).toBe(entity === 'account' ? 2 : 1);
    } finally {
      release.resolve();
    }
  });

  test(`${entity} 关闭、取消、保存、放弃和同数值重新打开`, async ({ cashier }) => {
    test.setTimeout(60_000);
    const book = await bankBook(cashier);
    const { page } = cashier;
    let editor = await openEditor(cashier, entity);
    await editor.amount.fill('abc');
    await editor.drawer.locator('.ant-drawer-close').click();
    let confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await confirm.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor.amount).toHaveValue('abc');
    await editor.drawer.getByRole('button', { name: '取消', exact: true }).click();
    confirm = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await confirm.getByRole('button', { name: '保存并关闭', exact: true }).click();
    await expect(editor.drawer).toBeVisible();
    await expect(editor.amount).toHaveValue('abc');
    expect(await rows(cashier, book, entity)).toEqual([]);
    await editor.drawer.getByRole('button', { name: '取消', exact: true }).click();
    await page
      .getByRole('dialog', { name: '有未保存内容', exact: true })
      .getByRole('button', { name: '放弃修改并关闭' })
      .click();
    await expect(editor.drawer).not.toBeVisible();
    editor = await openEditor(cashier, entity);
    await expect(editor.amount).toHaveValue('12.34');
    await editor.drawer.getByRole('button', { name: '取消', exact: true }).click();
    await page
      .getByRole('dialog', { name: '有未保存内容', exact: true })
      .getByRole('button', { name: '保存并关闭' })
      .click();
    await expect(editor.drawer).not.toBeVisible();
    expect((await rows(cashier, book, entity))[0]?.slice(1)).toEqual([
      entity === 'account' ? '发送时账户' : '发送时收款',
      1234,
      1,
    ]);
  });
}
