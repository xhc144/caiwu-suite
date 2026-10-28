import { expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

test('w_bb_def 在审核抽屉定义组合条件，保存刷新后真实生成审核结果', async ({ page, isolated }) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '合成组合审核', rows: 2, cols: 2 });
  template.cells = [
    { address: 'A1', kind: 'number', source: '10', unit: 'number', currency: 'CNY' },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await page.getByRole('button', { name: '审核公式', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '审核公式（勾稽）' });
  await drawer.getByRole('button', { name: '增加审核项', exact: true }).click();
  await drawer.getByRole('checkbox', { name: '使用条件表达式' }).check();
  await drawer
    .getByRole('textbox', { name: '审核条件', exact: true })
    .fill('A1 = 10 AND NOT (A1 > 10)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '审核公式', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: '审核条件', exact: true })).toHaveValue(
    'A1 = 10 AND NOT (A1 > 10)',
  );
  await page.keyboard.press('Escape');
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByText('审核1：通过', { exact: true })).toBeVisible();
  await expect(
    page.getByText('A1 = 10 AND NOT (A1 > 10)；条件成立', { exact: true }),
  ).toBeVisible();
});
