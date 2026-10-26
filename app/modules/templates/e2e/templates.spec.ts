import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Account, AccountCategory, BookInfo, CurrentUser, TemplateSummary } from '@caiwu/core';
import { callApi } from '@caiwu/testkit/e2e';
import { expectedAccounts, expectedTemplates } from '../test/expected-accounts';

const newBookInput = (templateId: string) => ({
  name: `M02-${templateId}-${randomUUID().slice(0, 8)}`,
  orgName: 'M02临时测试单位',
  templateId,
  product: 'chengben' as const,
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'm02-password',
});
type Login = { token: string; user: CurrentUser; book: BookInfo };
const accountSnapshot = (rows: Account[]) =>
  rows.map(({ code, name, categoryId, direction }) => ({
    code,
    name,
    categoryId,
    direction,
  }));

test('w_xt_kgzb_a2 / w_xt_kgzb_1 / w_xt_kgzb_3：HTTP列出五套 → 逐套建账登录 → 全科目核对 → 切换不串数据', async ({
  request,
}) => {
  const summaries = await callApi<TemplateSummary[]>(request, 'core.books.templates', undefined, {
    method: 'GET',
  });
  let previous: { token: string; rows: Account[]; bookId: string } | undefined;
  for (const expected of expectedTemplates) {
    const summary = summaries.find((t) => t.id === expected.id)!;
    expect(summary).toMatchObject({
      id: expected.id,
      regime: expected.regime,
      devOnly: false,
      status: 'current',
      codeScheme: `${expected.width}-2-2`,
      accountCount: expectedAccounts(expected).length,
    });
    if (expected.reviewCodes.length) expect(summary.description).toContain('待核');
    // 使用指定制度的核心建账接口；该接口不运行demo种子，不使用固定demo模板的helper。
    const book = await callApi<BookInfo>(request, 'core.books.create', newBookInput(expected.id));
    expect(book).toMatchObject({
      templateId: expected.id,
      regime: expected.regime,
      baseCurrency: 'CNY',
      codeScheme: [expected.width, 2, 2],
    });
    const login = await callApi<Login>(request, 'core.auth.login', {
      bookId: book.id,
      userCode: 'admin',
      password: 'm02-password',
    });
    const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
      token: login.token,
    });
    expect(accountSnapshot(rows)).toEqual(expectedAccounts(expected));
    expect(rows.every((a) => a.level === 1 && a.parentId === null && a.isLeaf)).toBe(true);
    expect(rows.filter((a) => a.isCash).map((a) => a.code)).toEqual([
      expected.width === 4 ? '1001' : '101',
    ]);
    expect(rows.filter((a) => a.isBank).map((a) => a.code)).toEqual([
      expected.width === 4 ? '1002' : '102',
    ]);
    expect(rows.every((a) => a.dimensions.length === 0 && a.currency === null)).toBe(true);
    const categories = await callApi<AccountCategory[]>(
      request,
      'core.accounts.categories',
      undefined,
      { token: login.token },
    );
    expect(categories).toEqual(expected.categories.map((c, sort) => ({ ...c, sort })));
    const me = await callApi<{ user: CurrentUser; book: BookInfo }>(
      request,
      'core.auth.me',
      undefined,
      { token: login.token },
    );
    expect(me.book).toEqual(book);
    expect(me.user).toMatchObject({ code: 'admin', isAdmin: true });
    if (previous) {
      expect(book.id).not.toBe(previous.bookId);
      expect(
        await callApi<Account[]>(request, 'core.accounts.list', undefined, {
          token: previous.token,
        }),
      ).toEqual(previous.rows);
    }
    previous = { token: login.token, rows, bookId: book.id };
  }
  await expect(callApi(request, 'core.accounts.list')).rejects.toThrow(/登录已失效/);
  await expect(callApi(request, 'core.accounts.categories')).rejects.toThrow(/登录已失效/);
  await expect(callApi(request, 'core.auth.me')).rejects.toThrow(/登录已失效/);
});

test('w_xt_kgzb_1 信息确认：真实账套选择/登录壳打开民非账，再切换基层工会账', async ({
  page,
  request,
}) => {
  const books = [];
  for (const templateId of ['nonprofit-2026', 'grassroots-trade-union-2022']) {
    books.push(await callApi<BookInfo>(request, 'core.books.create', newBookInput(templateId)));
  }
  for (const [index, book] of books.entries()) {
    if (index === 0) await page.goto('/');
    await expect(page.getByText('选择账套', { exact: true })).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: book.name });
    await expect(row).toContainText(book.templateName);
    await row.getByRole('button', { name: '进入' }).click();
    await expect(page).toHaveURL(`/login/${book.id}`);
    await expect(page.getByText(book.name, { exact: true })).toBeVisible();
    await page.getByLabel('密码').fill('m02-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/home');
    await expect(page.getByText('你好，系统管理员')).toBeVisible();
    await expect(page.locator('.ant-descriptions')).toContainText(book.templateName);
    await expect(page.locator('.ant-descriptions')).toContainText(book.codeScheme.join('-'));
    const session = await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string; bookId: string },
    );
    expect(session.bookId).toBe(book.id);
    const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
      token: session.token,
    });
    expect(accountSnapshot(rows)).toEqual(
      expectedAccounts(expectedTemplates.find((t) => t.id === book.templateId)!),
    );
    if (index === 0) {
      await page.getByRole('button', { name: /系统管理员/ }).hover();
      await page.getByRole('menuitem', { name: '切换账套' }).click();
      await expect(page).toHaveURL('/');
    }
  }
});

test('w_xt_kgzb_a2 阻止缺失制度、w_xt_kgzb_1 阻止错误级次；HTTP列表不出现失败账套', async ({
  request,
}) => {
  const failed = { ...newBookInput('nonprofit-2026'), orgName: `M02失败-${randomUUID()}` };
  await expect(
    callApi(request, 'core.books.create', { ...failed, templateId: '' }),
  ).rejects.toThrow();
  await expect(
    callApi(request, 'core.books.create', { ...failed, templateId: 'missing-template' }),
  ).rejects.toThrow(/不存在/);
  await expect(
    callApi(request, 'core.books.create', { ...failed, codeScheme: '3-2-2' }),
  ).rejects.toThrow(/不能使用科目级次/);
  const books = await callApi<BookInfo[]>(request, 'core.books.list');
  expect(books.filter((b) => b.orgName === failed.orgName)).toEqual([]);
});
