import { expect, test } from '@playwright/test';
import { createBook, loginWithNewBook } from '@caiwu/testkit/e2e';

test('新建账套 → 登录 → 首页和导航', async ({ page }) => {
  const name = `界面新建-${Date.now()}`;
  await page.goto('/');
  await expect(page.getByText('选择账套')).toBeVisible();
  await page.getByRole('button', { name: '新建账套' }).click();
  const dialog = page.getByRole('dialog', { name: '新建账套' });
  await dialog.getByLabel('账套名称').fill(name);
  await dialog.getByLabel('单位名称').fill('界面测试有限公司');
  await dialog.getByLabel('管理员密码').fill('pw');
  await dialog.getByRole('button', { name: '创建' }).click();

  await expect(page).toHaveURL(/\/login\//);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByLabel('密码').fill('pw');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText('你好，系统管理员')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /示范记账单/ })).toBeVisible(); // 开发模式显示示范模块
});

test('密码错误时提示原因', async ({ page, request }) => {
  const { bookId } = await createBook(request);
  await page.goto(`/login/${bookId}`);
  await page.getByLabel('密码').fill('wrong');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText('用户编号或密码不对')).toBeVisible();
});

test('多标签页：切换标签保留页面状态，Ctrl+F4 关闭标签', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  const activePage = page.getByRole('tabpanel').filter({ visible: true });
  const keyword = activePage.getByLabel('摘要', { exact: true });
  await keyword.fill('还没提交的筛选');
  await page.getByRole('tab', { name: '首页' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('tab', { name: '示范记账单' }).click();
  await expect(keyword).toHaveValue('还没提交的筛选');
  await page.keyboard.press('Control+F4');
  await expect(page.getByRole('tab', { name: '示范记账单' })).toHaveCount(0);
});

test('不存在的模块页面显示 404', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/no-such-module/x');
  await expect(page.getByText('页面不存在')).toBeVisible();
});
