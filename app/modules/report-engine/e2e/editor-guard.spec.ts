import { expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

test('w_bb_def 自定义定义登记壳守卫：切标签保稿，关闭所有可取消、保存或放弃', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    emptyTemplate({ code: '101', name: '自定义守卫合成报表', rows: 2, cols: 2 }),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  const cell = page.getByRole('textbox', { name: 'A1', exact: true });
  await cell.fill('由壳守卫保存的编辑');
  await page.getByRole('menuitem', { name: '首页', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('tab', { name: /报表/ }).last().click();
  await expect(cell).toHaveValue('由壳守卫保存的编辑');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(dialog).toContainText('报表定义：自定义守卫合成报表');
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(cell).toHaveValue('由壳守卫保存的编辑');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '保存并继续' })
    .click();
  await expect(page).toHaveURL(/\/home$/);
  const saved = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: report.id },
    { token },
  );
  expect(saved.revision).toBe(2);
  expect(saved.template.cells[0]!.source).toBe('由壳守卫保存的编辑');
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await cell.fill('=1/0');
  // 语法可以保存；引入真实乐观锁冲突，关闭时的保存必须保留草稿。
  await callApi<Report>(
    isolated.request,
    'm.report-engine.save',
    {
      id: saved.id,
      expectedRevision: saved.revision,
      template: { ...saved.template, name: '另一个窗口已修改' },
    },
    { token, method: 'POST' },
  );
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '保存并继续' })
    .click();
  await expect(page).toHaveURL(/\/designer\?id=/);
  await expect(cell).toHaveValue('=1/0');
  await expect(
    page.getByText(/已被其他操作修改|版本.*变化|版本.*过期|已被修改/).first(),
  ).toBeVisible();
  await page.locator('.ant-notification-notice-close').click();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await dialog.getByRole('button', { name: '放弃修改并继续' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await expect(cell).toHaveValue('由壳守卫保存的编辑');
});
