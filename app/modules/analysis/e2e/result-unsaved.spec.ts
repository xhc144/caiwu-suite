import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { AnalysisSheet } from '../custom';
import { test, expect } from './fixture';

test('w_fx_demo 统一退出守卫保存已有金额稿：取消和失败保留，重试更新原记录，重登回读', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  const definition = await callApi<{ id: number }>(
    isolated.request,
    'm.analysis.definitions.save',
    {
      code: '739',
      name: '合成统一守卫定义',
      expectedRevision: 0,
      rows: [{ key: 1, name: '合成金额', formula: '123.45', unit: 'money' }],
    },
    { token },
  );
  const sheet = await callApi<AnalysisSheet>(
    isolated.request,
    'm.analysis.definitions.calculate',
    { definitionId: definition.id, periodFrom: 202601, periodTo: 202601 },
    { token, method: 'GET' },
  );
  const original = await callApi<{ id: number }>(
    isolated.request,
    'm.analysis.results.save',
    { expectedRevision: 0, name: '合成统一守卫金额稿', sheet },
    { token },
  );
  await page.goto(`${isolated.origin}/m/analysis/results`);
  await page
    .getByRole('row')
    .filter({ hasText: '合成统一守卫金额稿' })
    .getByRole('button', { name: '打开结果', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '分析结果编辑与保存', exact: true });
  const amount = editor.getByLabel('1-202601', { exact: true });
  await amount.fill('180.25');
  const leave = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await page.keyboard.press('Alt+x');
  await expect(leave).toContainText('合成统一守卫金额稿');
  await leave.getByRole('button', { name: /取\s*消/ }).click();
  await expect(leave).toHaveCount(0);
  await expect(amount).toHaveValue('180.25');
  let failOnce = true;
  await page.route('**/trpc/**', async (route) => {
    if (route.request().url().includes('m.analysis.results.save') && failOnce) {
      failOnce = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.keyboard.press('Alt+x');
  await leave.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(leave).toHaveCount(0);
  await expect(editor.getByText('保存未完成，当前输入仍保留', { exact: true })).toBeVisible();
  await expect(amount).toHaveValue('180.25');
  const before = await callApi<{ sheet: AnalysisSheet; revision: number }>(
    isolated.request,
    'm.analysis.results.get',
    { id: original.id },
    { token },
  );
  expect(before.revision).toBe(1);
  expect(before.sheet.rows[0]!.values).toEqual([12345]);
  await page.keyboard.press('Alt+x');
  const saving = page.waitForResponse(
    (response) =>
      response.url().includes('m.analysis.results.save') && response.request().method() === 'POST',
  );
  await leave.getByRole('button', { name: '保存并继续', exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await expect(page.getByText('选择账套', { exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: bookId })
    .getByRole('button', { name: '进入', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\//);
  await page.getByLabel('密码', { exact: true }).fill('admin');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('menuitem', { name: '已保存分析结果', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: '合成统一守卫金额稿' })
    .getByRole('button', { name: '打开结果', exact: true })
    .click();
  await expect(amount).toHaveValue('180.25');
  await editor.getByLabel('显示取数原值', { exact: true }).check();
  await expect(editor.getByText('原值：123.45', { exact: true })).toBeVisible();
  const login = await callApi<{ token: string }>(isolated.request, 'core.auth.login', {
    bookId,
    userCode: 'admin',
    password: 'admin',
  });
  const rows = await callApi<{ id: number; revision: number }[]>(
    isolated.request,
    'm.analysis.results.list',
    undefined,
    { token: login.token },
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: original.id, revision: 2 });
  const saved = await callApi<{ sheet: AnalysisSheet }>(
    isolated.request,
    'm.analysis.results.get',
    { id: original.id },
    { token: login.token },
  );
  expect(saved.sheet.rows[0]).toMatchObject({ values: [18025], originalValues: [12345] });
});
