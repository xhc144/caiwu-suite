import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

test('w_main1/w_cb_tzxx：正常壳标签保留设置草稿，关闭所有取消或保存，不整页重载', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/inventory/settings');
  await expect(page.getByRole('heading', { name: '仓库设置', exact: true })).toBeVisible();
  const autoRefresh = page.getByRole('checkbox', { name: '单据自动刷新', exact: true });
  await expect(autoRefresh).toBeChecked();
  await autoRefresh.uncheck();
  await page.evaluate(() => {
    document.documentElement.dataset.inventoryNavigationMarker = 'same-document';
  });
  await page
    .getByRole('navigation', { name: '进销存页面入口' })
    .getByRole('link', { name: '库存台账', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '库存与台账', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.inventoryNavigationMarker),
  ).toBe('same-document');
  await page.getByRole('tab', { name: '仓库设置', exact: true }).click();
  await expect(autoRefresh).not.toBeChecked();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(confirmation).toContainText('仓库设置');
  await expect(confirmation).not.toContainText('库存与台账');
  await confirmation.getByRole('button', { name: /^取\s*消$/ }).click();
  await expect(autoRefresh).not.toBeChecked();
  await expect(page.getByRole('tab', { name: '库存与台账', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await confirmation.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('tab', { name: '仓库设置', exact: true })).toHaveCount(0);
  const context = await callApi<{ settings: { autoRefresh: boolean } }>(
    request,
    'm.inventory.context',
    undefined,
    { token, method: 'GET' },
  );
  expect(context.settings.autoRefresh).toBe(false);
});

test('w_cb_cpda：壳关闭保存失败保留产品输入，放弃后可关闭', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/inventory/master');
  await page
    .getByRole('navigation', { name: '进销存页面入口' })
    .getByRole('link', { name: '库存台账', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '库存与台账', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '产品与仓库', exact: true }).click();
  await page.getByRole('button', { name: '新增产品', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增产品', exact: true });
  await editor.getByLabel('产品编号', { exact: true }).fill('SHELL-UNSAVED');
  await page.getByRole('tab', { name: '库存与台账', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(confirmation).toContainText('产品档案：SHELL-UNSAVED');
  await confirmation.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByText('产品名称不能为空', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: '产品与仓库', exact: true }).click();
  await expect(editor.getByLabel('产品编号', { exact: true })).toHaveValue('SHELL-UNSAVED');
  expect(
    await callApi<unknown[]>(request, 'm.inventory.products', {}, { token, method: 'GET' }),
  ).toHaveLength(0);
  await page.getByRole('tab', { name: '库存与台账', exact: true }).click();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('tab', { name: '产品与仓库', exact: true })).toHaveCount(0);
});
