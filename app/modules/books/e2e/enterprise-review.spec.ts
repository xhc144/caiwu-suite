import { expect, test } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import type { Account, BookInfo } from '@caiwu/core';

test('w_xt_kgzb_a2/1：旧企业样例警告贯穿新建，已有账套不补改，登录后真实核对9科目', async ({
  page,
  request,
}) => {
  // 前置只用core，避免依赖其他未完成页面。
  const old = await callApi<BookInfo>(request, 'core.books.create', {
    name: `企业旧样例-${Date.now()}`,
    orgName: '合成旧单位',
    templateId: 'books-enterprise-review',
    product: 'qingsong',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'old-pass',
  });
  const oldLogin = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: old.id,
    userCode: 'admin',
    password: 'old-pass',
  });
  const before = await callApi<Account[]>(request, 'core.accounts.list', undefined, oldLogin);
  expect(before).toHaveLength(9);
  await expect(callApi(request, 'core.accounts.list')).rejects.toThrow(/登录/);

  await page.goto('/');
  await page.getByRole('button', { name: '新建账套', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
  await wizard.getByLabel('账套名称', { exact: true }).fill(`企业新样例-${Date.now()}`);
  await wizard.getByLabel('单位名称', { exact: true }).fill('合成新单位');
  await wizard.getByLabel('管理员密码').fill('new-pass');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('radio', { name: /企业会计准则（9项待核工程样例）/ }).check();
  const warning = wizard.getByRole('alert').filter({ hasText: '所选模板有9项待核科目' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('仅在本次新建时生成科目，不补改已有账套');
  for (let step = 0; step < 3; step++) {
    await wizard.getByRole('button', { name: '下一步' }).click();
    await expect(warning).toBeVisible();
  }
  await expect(wizard).toContainText('最终复核');
  await expect(warning).toContainText('不是完整科目编码来源');
  await wizard.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/login\//);
  expect(page.url()).not.toContain(old.id);
  await page.getByLabel('用户编号', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('new-pass');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  const token = await page.evaluate(
    () => (JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string }).token,
  );
  const accounts = await callApi<Account[]>(request, 'core.accounts.list', undefined, { token });
  expect(
    accounts.map(({ code, name, categoryId, direction }) => ({
      code,
      name,
      categoryId,
      direction,
    })),
  ).toEqual(
    before.map(({ code, name, categoryId, direction }) => ({ code, name, categoryId, direction })),
  );
  expect(
    (await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, { token })).book,
  ).toMatchObject({
    templateId: old.templateId,
    orgName: '合成新单位',
  });
  expect(await callApi<Account[]>(request, 'core.accounts.list', undefined, oldLogin)).toEqual(
    before,
  );
  expect(
    (await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, oldLogin)).book,
  ).toEqual(old);
});
