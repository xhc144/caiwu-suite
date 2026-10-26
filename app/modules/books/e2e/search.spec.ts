import { expect, test } from '@playwright/test';
import { callApi, createBook, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { BookInfo, BookSummary } from '@caiwu/core';

test('w_xt_tz_find：空结果键盘安全，刷新换序保留账套身份，编号查找后进入同一账套', async ({
  page,
  request,
}) => {
  const prefix = `身份选择-${Date.now()}`;
  const a = await createBook(request, { name: `${prefix}-A` });
  const b = await createBook(request, { name: `${prefix}-B` });
  await page.goto('/');
  const search = page.getByRole('textbox', { name: '搜索账套' });
  await search.fill(`${prefix}-不存在`);
  await expect(page.getByText('没有匹配的账套，请修改搜索内容')).toBeVisible();
  await search.press('ArrowDown');
  await search.press('ArrowUp');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await search.fill(prefix);
  await expect(page.getByRole('row', { selected: true })).toContainText(a.bookId);
  const loginA = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: a.bookId,
    userCode: 'admin',
    password: 'admin',
  });
  await callApi(
    request,
    'm.books.update',
    { name: `${prefix}-Z`, orgName: '首项换序单位' },
    { token: loginA.token },
  );
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('row', { selected: true })).toContainText(`${prefix}-Z`);
  await expect(page.getByRole('row', { selected: true })).toContainText(a.bookId);
  await search.press('ArrowUp');
  await expect(page.getByRole('row', { selected: true })).toContainText(b.bookId);
  const login = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: b.bookId,
    userCode: 'admin',
    password: 'admin',
  });
  await callApi(
    request,
    'm.books.update',
    { name: `${prefix}-0`, orgName: '刷新改名单位' },
    { token: login.token },
  );
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('row', { selected: true })).toContainText(`${prefix}-0`);
  await expect(page.getByRole('row', { selected: true })).toContainText(b.bookId);
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/login/${b.bookId}$`));
  await page.getByRole('button', { name: '返回账套列表', exact: true }).click();
  await search.fill(` ${b.bookId.toUpperCase()} `);
  await expect(page.getByRole('row', { selected: true })).toContainText(`${prefix}-0`);
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/login/${b.bookId}$`));
});

test('w_tzjl / w_tzjl_2：管理页查找同名来源的编号，真实复制后检索副本并核对独立身份', async ({
  page,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const name = `同名来源-${Date.now()}`;
  const source = await createBook(request, { name });
  await createBook(request, { name });
  await page.goto('/m/books/manage');
  const search = page.getByRole('textbox', { name: '搜索账套' });
  await search.fill(name);
  await expect(page.getByText('共2个匹配账套')).toBeVisible();
  await search.fill(`${name}-不存在`);
  await expect(page.getByText('没有匹配的账套，请修改搜索内容')).toBeVisible();
  await search.fill(source.bookId);
  await expect(page.getByText('共1个匹配账套')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(source.bookId) });
  await row.getByRole('button', { name: '复制', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '复制账套', exact: true });
  await expect(dialog).toContainText(source.bookId);
  await expect(dialog).toContainText('副本继承来源账套的操作员、密码、权限及全部业务数据');
  const copyName = `查找复制品-${Date.now()}`;
  await dialog.getByLabel('目标用户代码').fill('admin');
  await dialog.getByLabel('目标当前密码').fill('admin');
  await dialog.getByLabel('新账套名称').fill(copyName);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '确认复制' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeVisible();
  await search.fill(copyName);
  await expect(page.getByText('共1个匹配账套')).toBeVisible();
  const copied = (await callApi<BookSummary[]>(request, 'core.books.list')).find(
    (b) => b.name === copyName,
  )!;
  expect(copied.id).not.toBe(source.bookId);
  expect(copied.id).not.toBe(bookId);
  await expect(page.getByRole('row', { name: new RegExp(copied.id) })).toBeVisible();
  const login = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: copied.id,
    userCode: 'admin',
    password: 'admin',
  });
  const info = await callApi<BookInfo>(request, 'm.books.info', undefined, {
    token: login.token,
    method: 'GET',
  });
  expect(info).toMatchObject({ id: copied.id, name: copyName, orgName: 'E2E 测试单位' });
  expect(
    (await callApi<BookSummary[]>(request, 'core.books.list')).find((b) => b.id === source.bookId)
      ?.name,
  ).toBe(name);
});
