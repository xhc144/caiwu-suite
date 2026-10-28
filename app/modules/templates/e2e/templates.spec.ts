import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Account, AccountCategory, BookInfo, CurrentUser, TemplateSummary } from '@caiwu/core';
import { callApi } from '@caiwu/testkit/e2e';
import { expectedAccounts, expectedTemplates } from '../test/expected-accounts';
import { parseCodeScheme } from '@caiwu/core';
import { loadedAccountSnapshot, registeredTemplates } from '../test/template-fixtures';

const templates = registeredTemplates();

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

test('w_xt_kgzb_a2 / w_xt_kgzb_1 / w_xt_kgzb_3：HTTP列出制度 → 逐套建账登录 → 全科目与父链核对 → 切换不串数据', async ({
  request,
}) => {
  const summaries = await callApi<TemplateSummary[]>(request, 'core.books.templates', undefined, {
    method: 'GET',
  });
  let previous: { token: string; rows: Account[]; bookId: string } | undefined;
  for (const template of templates) {
    const expected = expectedTemplates.find((t) => t.id === template.id);
    const summary = summaries.find((t) => t.id === template.id)!;
    expect(summary).toMatchObject({
      id: template.id,
      regime: template.regime,
      devOnly: false,
      status: 'current',
      codeScheme: template.codeScheme,
      accountCount: template.accounts.length,
    });
    expect(summary.description).toBe(template.description);
    // 使用指定制度的核心建账接口；该接口不运行demo种子，不使用固定demo模板的helper。
    const book = await callApi<BookInfo>(request, 'core.books.create', newBookInput(template.id));
    expect(book).toMatchObject({
      templateId: template.id,
      regime: template.regime,
      baseCurrency: 'CNY',
      codeScheme: parseCodeScheme(template.codeScheme),
    });
    const login = await callApi<Login>(request, 'core.auth.login', {
      bookId: book.id,
      userCode: 'admin',
      password: 'm02-password',
    });
    const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
      token: login.token,
    });
    expect(rows).toHaveLength(template.accounts.length);
    expect(rows).toMatchObject(loadedAccountSnapshot(template, rows));
    if (expected) {
      expect(accountSnapshot(rows.filter((a) => a.level === 1))).toEqual(
        expectedAccounts(expected),
      );
      expect(rows.filter((a) => a.isCash).map((a) => a.code)).toEqual([
        expected.width === 4 ? '1001' : '101',
      ]);
      expect(rows.filter((a) => a.isBank).map((a) => a.code)).toEqual([
        expected.width === 4 ? '1002' : '102',
      ]);
    }
    expect(rows.every((a) => a.currency === null)).toBe(true);
    const categories = await callApi<AccountCategory[]>(
      request,
      'core.accounts.categories',
      undefined,
      { token: login.token },
    );
    expect(categories).toEqual(template.categories.map((c, sort) => ({ ...c, sort })));
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
    // 账套入口可由壳列表或模块表格提供，按唯一账套名定位对应条目。
    const entry = page
      .getByRole('listitem')
      .or(page.getByRole('row'))
      .filter({ has: page.getByText(book.name, { exact: true }) });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(book.templateName);
    await entry.getByRole('button', { name: '进入', exact: true }).click();
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
    expect(accountSnapshot(rows.filter((a) => a.level === 1))).toEqual(
      expectedAccounts(expectedTemplates.find((t) => t.id === book.templateId)!),
    );
    if (index === 0) {
      await page.getByRole('button', { name: /系统管理员/ }).hover();
      const userMenu = page.getByRole('menu').filter({
        has: page.getByRole('menuitem', { name: /退出登录$/ }),
      });
      await userMenu.getByRole('menuitem', { name: /切换账套$/ }).click();
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

for (const codeScheme of ['4-2-2', '4-3-3']) {
  test(`w_xt_kgzb_a2：从真实新建入口选择民非2026，${codeScheme}建账持久化四项必填往来`, async ({
    page,
    request,
  }) => {
    const name = `W2民非-${codeScheme}-${randomUUID().slice(0, 8)}`;
    await page.goto('/');
    await page.getByRole('button', { name: '新建账套', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    await wizard.getByLabel('账套名称', { exact: true }).fill(name);
    await wizard.getByLabel('单位名称', { exact: true }).fill('民非往来独立测试单位');
    await wizard.getByLabel('管理员密码').fill('w2-partners');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByRole('radio', { name: /民间非营利组织会计制度/ }).check();
    await expect(wizard).toContainText('适用2026年1月1日');
    await expect(wizard).toContainText('1121/1141/2202/2203启用必填往来对象');
    await expect(wizard).toContainText('限定/非限定');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByLabel('科目级次', { exact: true }).fill(codeScheme);
    await wizard.getByRole('button', { name: '下一步' }).click();
    await expect(wizard.getByText('当前支持人民币本位币（CNY）')).toBeVisible();
    await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await expect(wizard).toContainText('最终复核');
    await wizard.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page).toHaveURL(/\/login\//);
    const bookId = page.url().split('/').at(-1)!;
    await page.getByLabel('密码', { exact: true }).fill('w2-partners');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/home');
    const session = await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string; bookId: string },
    );
    expect(session.bookId).toBe(bookId);
    const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
      token: session.token,
    });
    expect(rows).toHaveLength(templates.find((t) => t.id === 'nonprofit-2026')!.accounts.length);
    expect(rows.filter((a) => a.level === 1)).toHaveLength(56);
    expect(rows.filter((a) => a.isPartner).map((a) => a.code)).toEqual([
      '1121',
      '1141',
      '2202',
      '2203',
    ]);
    for (const code of ['1121', '1141', '2202', '2203']) {
      expect(rows.find((a) => a.code === code)).toMatchObject({
        level: 1,
        parentId: null,
        isLeaf: true,
        direction: code.startsWith('1') ? 'debit' : 'credit',
        dimensions: [{ type: 'partner', required: true, defaultItemId: null }],
      });
    }
    expect(await callApi(request, 'core.dimensions.items', {}, { token: session.token })).toEqual(
      [],
    );
    await page.reload();
    expect(
      await callApi(request, 'core.accounts.list', undefined, { token: session.token }),
    ).toEqual(rows);
    const me = await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, {
      token: session.token,
    });
    expect(me.book.codeScheme.join('-')).toBe(codeScheme);
    expect(me.book.templateId).toBe('nonprofit-2026');
    expect(
      (await callApi<BookInfo[]>(request, 'core.books.list')).filter((b) => b.name === name),
    ).toHaveLength(1);
  });
}

for (const example of [
  { id: 'trade-union-2022', selection: /^工会会计制度/, code: '503010102', name: '项目支出' },
  {
    id: 'school-canteen-anhui-2021',
    selection: /^安徽营养改善计划学校食堂/,
    code: '52010101',
    name: '粮食',
  },
  {
    id: 'individual-business-1997',
    selection: /^个体工商户会计制度/,
    code: '14101',
    name: '待处理存货损失',
  },
]) {
  test(`w_xt_kgzb_a2 / a3：真实向导选择${example.id}并保留制度默认级次及末级明细`, async ({
    page,
    request,
  }) => {
    const template = templates.find((t) => t.id === example.id)!;
    const name = `制度明细-${example.id}-${randomUUID().slice(0, 8)}`;
    await page.goto('/');
    await page.getByRole('button', { name: '新建账套', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    await wizard.getByLabel('账套名称', { exact: true }).fill(name);
    await wizard.getByLabel('单位名称', { exact: true }).fill('合成制度验证单位');
    await wizard.getByLabel('管理员密码').fill('template-details');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByRole('radio', { name: example.selection }).check();
    await wizard.getByRole('button', { name: '下一步' }).click();
    await expect(wizard.getByLabel('科目级次', { exact: true })).toHaveValue(template.codeScheme);
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await expect(wizard).toContainText('最终复核');
    await wizard.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page).toHaveURL(/\/login\//);
    const bookId = page.url().split('/').at(-1)!;
    await page.getByLabel('密码', { exact: true }).fill('template-details');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/home');
    const session = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string },
    );
    const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
      token: session.token,
    });
    expect(rows).toHaveLength(template.accounts.length);
    expect(rows).toMatchObject(loadedAccountSnapshot(template, rows));
    expect(rows.find((a) => a.code === example.code)).toMatchObject({
      name: example.name,
      isLeaf: true,
    });
    const me = await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, {
      token: session.token,
    });
    expect(me.book).toMatchObject({
      id: bookId,
      templateId: template.id,
      codeScheme: parseCodeScheme(template.codeScheme),
    });
    await page.reload();
    expect(
      await callApi(request, 'core.accounts.list', undefined, { token: session.token }),
    ).toEqual(rows);
  });
}
