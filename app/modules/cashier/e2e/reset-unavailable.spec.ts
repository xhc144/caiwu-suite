import { test, expect } from './fixture';
import { bankBook, documents, recordThree } from './scenarios';

test.use({ cashierHost: 'without-reset-protection' });

// 此用例验证未提供保护备份能力的宿主：服务端必须报错，不能退化成直接清空。
test('w_cn_xtcsh 宿主保护备份未接入时真实页面显示失败且账户、期初、单据全部保留', async ({
  cashier,
}) => {
  const book = await bankBook(cashier);
  await recordThree(cashier, book);
  const before = await documents(cashier, book);
  const { page } = cashier;
  await page.goto('/m/cashier/accounts');
  await page.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '重新初始化出纳', exact: true });
  await expect(drawer.getByText('将删除当前账套的全部出纳数据')).toBeVisible();
  await drawer.getByLabel('确认初始化账套名称').fill(book.bookName);
  await drawer.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认备份后清空全部出纳数据' });
  await confirmation.getByLabel('确认文字').fill('清空出纳数据');
  const response = page.waitForResponse(
    (r) => r.url().includes('m.cashier.reset') && r.request().method() === 'POST',
  );
  await confirmation.getByRole('button', { name: '创建保护备份并清空' }).click();
  expect((await response).ok()).toBe(false);
  await expect(page.getByText('完整保护备份暂不可用，出纳数据尚未清空')).toBeVisible();
  await expect(drawer.getByLabel('确认初始化账套名称')).toHaveValue(book.bookName);
  expect(await documents(cashier, book)).toEqual(before);
  await drawer.locator('button.ant-drawer-close').click();
  await expect(page.getByRole('row', { name: /闭环银行/ })).toContainText('1,000.00');
  await cashier.withServices(book.bookId, async (svc) => {
    const bank = (await svc.accounts.require('100201')).id;
    expect(await svc.opening.list(2026)).toContainEqual(
      expect.objectContaining({ accountId: bank, balance: 100000 }),
    );
  });
});
