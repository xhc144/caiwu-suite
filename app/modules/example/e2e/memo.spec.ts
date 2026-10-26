import { expect, test } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';

test('示范记账单：新增 → 生成凭证 → 凭证号显示在列表里', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  await expect(page.getByRole('heading', { name: '示范记账单' })).toBeVisible();

  await page.keyboard.press('Alt+N');
  const drawer = page.getByRole('dialog', { name: '新增记账单' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('摘要').fill('购买办公用品');
  // 全键盘：输入后按 Enter 选中第一个匹配项。科目支持拼音首字母：glfy = 管理费用
  await drawer.getByLabel('借方科目').fill('glfy');
  await page.keyboard.press('Enter');
  // 选中管理费用后，因为它启用了部门核算，表单里会出现"部门"
  await expect(drawer.getByLabel('部门')).toBeVisible();
  await drawer.getByLabel('部门').fill('行政');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('贷方科目').fill('1001');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('金额').fill('1,234.5');
  await drawer.getByRole('button', { name: '保存' }).click();

  const row = page.getByRole('row', { name: /购买办公用品/ });
  await expect(row).toContainText('6602 管理费用');
  await expect(row).toContainText('1001 库存现金');
  await expect(row).toContainText('行政部');
  await expect(row).toContainText('1,234.50');
  await expect(row).toContainText('未生成');
  await row.getByRole('button', { name: '生成凭证' }).click();
  await expect(row).toContainText('记-0001');
  await expect(row).toContainText('待审核');
});
