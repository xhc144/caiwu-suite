import { expect, test, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, BookSummary } from '@caiwu/core';

const tokenOf = (page: Page) =>
  page.evaluate(
    () => (JSON.parse(sessionStorage.getItem('caiwu.session') ?? '{}') as { token: string }).token,
  );
async function login(page: Page, password: string, code = 'admin') {
  await page.getByLabel('用户编号', { exact: true }).fill(code);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}
async function selectBook(page: Page, name: string) {
  await expect(page.getByText('选择账套', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索账套' }).fill(name);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login\//);
}
async function changeBook(page: Page) {
  await page.getByRole('menuitem', { name: '切换账套', exact: true }).click();
  await page.getByRole('button', { name: '退出并选择账套' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('w_login / w_xt_kgzb / w_tzjl：UI创建66科目 → 壳登录 → A-B-A隔离及刷新', async ({
  page,
  request,
}) => {
  const secondPage = await page.context().newPage();
  const second = await loginWithNewBook(secondPage, request, { name: `M01第二账套-${Date.now()}` });
  await secondPage.close();
  const name = `M01小企业-${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: '新建账套', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
  await wizard.getByLabel('账套名称', { exact: true }).fill(name);
  await wizard.getByLabel('单位名称', { exact: true }).fill('小企业独立单位');
  await wizard.getByLabel('管理员姓名').fill('小企业管理员');
  await wizard.getByLabel('管理员密码').fill('small-pass');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('radio', { name: /小企业会计准则/ }).check();
  await expect(wizard).toContainText('small-appendix.pdf');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByLabel('科目级次', { exact: true }).fill('3-2-2');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await expect(wizard.getByText(/科目 1001 的一级编码需要 4 位/)).toBeVisible();
  await wizard.getByLabel('科目级次', { exact: true }).fill('4-3-3');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await expect(wizard.getByText('当前支持人民币本位币（CNY）')).toBeVisible();
  await wizard.getByLabel('启用月份').fill('7');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await expect(wizard).toContainText('最终复核');
  await wizard.getByRole('button', { name: '上一步' }).click();
  await expect(wizard.getByLabel('启用月份')).toHaveValue('7');
  await wizard.getByRole('button', { name: '下一步' }).click();
  // 浏览器同一事件循环连续触发两次，验证提交锁而非依赖按钮动画。
  await wizard
    .getByRole('button', { name: '创建', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/\/login\//);
  const bookId = page.url().split('/').at(-1)!;
  expect(
    (await callApi<BookSummary[]>(request, 'core.books.list')).filter((b) => b.name === name),
  ).toHaveLength(1);
  await login(page, 'small-pass');
  const firstToken = await tokenOf(page);
  const accounts = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token: firstToken,
  });
  expect(accounts).toHaveLength(66);
  for (const [code, name] of [
    ['1001', '库存现金'],
    ['1602', '累计折旧'],
    ['1702', '累计摊销'],
    ['5801', '所得税费用'],
  ])
    expect(accounts.find((a) => a.code === code)?.name).toBe(name);
  expect(accounts.find((a) => a.code === '1702')?.direction).toBe('credit');
  await page.getByRole('menuitem', { name: '账套信息', exact: true }).click();
  await expect(page.getByLabel('单位名称', { exact: true })).toHaveValue('小企业独立单位');
  await page.getByLabel('单位名称', { exact: true }).fill('小企业保存后单位');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('账套信息已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('单位名称', { exact: true })).toHaveValue('小企业保存后单位');
  await changeBook(page);
  await expect(callApi(request, 'core.auth.me', undefined, { token: firstToken })).rejects.toThrow(
    /登录/,
  );
  await selectBook(page, second.bookName);
  await login(page, 'admin');
  const secondToken = await tokenOf(page);
  expect(secondToken).not.toBe(firstToken);
  const meB = await callApi<{
    book: { id: string; orgName: string };
    user: { name: string; isAdmin: boolean };
  }>(request, 'core.auth.me', undefined, { token: secondToken });
  expect(meB.book).toMatchObject({ id: second.bookId, orgName: 'E2E 测试单位' });
  expect(meB.user).toMatchObject({ name: '系统管理员', isAdmin: true });
  expect(
    (await callApi<Account[]>(request, 'core.accounts.list', undefined, { token: secondToken }))
      .length,
  ).not.toBe(66);
  await page.getByRole('menuitem', { name: '账套信息', exact: true }).click();
  await expect(page.getByLabel('单位名称', { exact: true })).toHaveValue('E2E 测试单位');
  await changeBook(page);
  await selectBook(page, name);
  await login(page, 'small-pass');
  const tokenA2 = await tokenOf(page);
  const meA = await callApi<{
    book: { id: string; orgName: string };
    user: { name: string; isAdmin: boolean };
  }>(request, 'core.auth.me', undefined, { token: tokenA2 });
  expect(meA.book).toMatchObject({ id: bookId, orgName: '小企业保存后单位' });
  expect(meA.user).toMatchObject({ name: '小企业管理员', isAdmin: true });
  expect(
    (await callApi<Account[]>(request, 'core.accounts.list', undefined, { token: tokenA2 })).length,
  ).toBe(66);
  await expect(page.getByRole('tab', { name: '账套信息', exact: true })).toHaveCount(0);
});

test('w_tzjl_1 / w_xt_tz_find：取消向导零半成品、无结果搜索、双击与刷新', async ({
  page,
  request,
}) => {
  const name = `取消新建-${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: '新建账套', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
  await wizard.getByLabel('账套名称', { exact: true }).fill(name);
  await wizard.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(wizard.getByLabel('账套名称', { exact: true })).toHaveValue(name);
  await wizard.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃创建', exact: true }).click();
  expect(
    (await callApi<BookSummary[]>(request, 'core.books.list')).some((b) => b.name === name),
  ).toBe(false);
  await page.getByRole('textbox', { name: '搜索账套' }).fill(name);
  await expect(page.getByText('没有匹配的账套，请修改搜索内容')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索账套' })).toHaveValue('');
  const b = await callApi<{ id: string; name: string }>(request, 'core.books.create', {
    name: `双击-${Date.now()}`,
    orgName: '双击测试单位',
    templateId: 'books-small-business',
    product: 'qingsong',
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'pw',
  });
  await page.getByRole('button', { name: '刷新列表' }).click();
  await page.getByRole('textbox', { name: '搜索账套' }).fill(b.name);
  await page.getByRole('row', { name: new RegExp(b.name) }).dblclick();
  await expect(page).toHaveURL(new RegExp(`/login/${b.id}$`));
  await page.reload();
  await expect(page.getByText(b.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回账套列表', exact: true }).click();
  await page.getByRole('button', { name: '新建账套', exact: true }).click();
  await page
    .getByRole('dialog', { name: '新建账套', exact: true })
    .getByLabel('账套名称', { exact: true })
    .fill('浏览器后退保留');
  page.once('dialog', (dialog) => void dialog.dismiss());
  // 后退被确认框取消时没有load事件，直接触发真实history遍历并检查页面状态。
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page
      .getByRole('dialog', { name: '新建账套', exact: true })
      .getByLabel('账套名称', { exact: true }),
  ).toHaveValue('浏览器后退保留');
  page.once('dialog', (dialog) => void dialog.accept());
  // 后退被确认框取消时没有load事件，直接触发真实history遍历并检查页面状态。
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(new RegExp(`/login/${b.id}$`));
});

test('w_tzjl_2 / w_tzjl_kl：管理界面真实复制、目标口令拦截、备份后取消与安全删除', async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const make = (name: string) =>
    callApi<{ id: string; name: string }>(request, 'core.books.create', {
      name,
      orgName: '复制删除测试单位',
      templateId: 'books-small-business',
      product: 'qingsong',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'target-pass',
    });
  const actor = await make(`管理当前-${suffix}`);
  const source = await make(`管理来源-${suffix}`);
  const copyName = `管理复制-${suffix}`;
  await page.goto(`/login/${actor.id}`);
  await login(page, 'target-pass');
  await page.getByRole('menuitem', { name: '账套管理', exact: true }).click();
  await expect(
    page
      .getByRole('row', { name: new RegExp(actor.name) })
      .getByRole('button', { name: '删除', exact: true }),
  ).toBeDisabled();
  const sourceRow = page.getByRole('row', { name: new RegExp(source.name) });
  await sourceRow.getByRole('button', { name: '复制', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '复制账套', exact: true });
  await dialog.getByLabel('目标用户代码').fill('admin');
  await dialog.getByLabel('目标当前密码').fill('wrong');
  await dialog.getByLabel('新账套名称').fill(copyName);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '确认复制' }).click();
  await expect(page.getByText('目标账套用户代码或当前密码错误', { exact: true })).toBeVisible();
  await dialog.getByLabel('目标当前密码').fill('target-pass');
  await dialog.getByRole('button', { name: '确认复制' }).click();
  await expect(dialog).toHaveCount(0);
  const copyRow = page.getByRole('row', { name: new RegExp(copyName) });
  await expect(copyRow).toBeVisible();
  const copied = (await callApi<BookSummary[]>(request, 'core.books.list')).find(
    (b) => b.name === copyName,
  )!;
  expect(copied.id).not.toBe(source.id);
  const targetSession = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: copied.id,
    userCode: 'admin',
    password: 'target-pass',
  });
  const prepare = async () => {
    await copyRow.getByRole('button', { name: '删除', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '删除账套：身份验证与自动备份', exact: true });
    await dialog.getByLabel('目标用户代码').fill('admin');
    await dialog.getByLabel('目标当前密码').fill('target-pass');
    await dialog.getByRole('button', { name: '验证并自动备份' }).click();
    await expect(dialog.getByText('自动备份成功，请再次确认', { exact: true })).toBeVisible();
  };
  await prepare();
  await dialog.getByRole('button', { name: '取消删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(copyRow).toBeVisible();
  await prepare();
  await dialog.getByLabel(`逐字输入目标账套名称：${copyName}`).fill('错误名称');
  await expect(dialog.getByRole('button', { name: '确认删除并保留备份' })).toBeDisabled();
  await dialog.getByLabel(`逐字输入目标账套名称：${copyName}`).fill(copyName);
  await dialog.getByRole('button', { name: '确认删除并保留备份' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(copyRow).toHaveCount(0);
  await expect(sourceRow).toBeVisible();
  await expect(
    callApi(request, 'core.auth.me', undefined, { token: targetSession.token }),
  ).rejects.toThrow(/登录/);
  expect(
    (await callApi<BookSummary[]>(request, 'core.books.list')).some((b) => b.id === source.id),
  ).toBe(true);
});
