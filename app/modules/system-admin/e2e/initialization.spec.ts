import { expect, test, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function login(page: Page, bookId: string, date = '2026-06-20') {
  await page.goto(`/login/${bookId}`);
  await page.getByLabel('密码', { exact: true }).fill('admin');
  await page.getByLabel('操作日期', { exact: true }).fill(date);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}
const token = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('caiwu.session')!).token as string);

test('w_login 操作日期可独立录入，保存后重载仍属于当前会话，其他登录不受影响', async ({
  page,
  context,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const ui = await context.newPage();
  await login(ui, bookId);
  await ui.goto('/m/system-admin/operation-date');
  await expect(ui.getByText('当前操作日期：2026-06-20', { exact: false })).toBeVisible();
  await ui.locator('input[type="date"]').fill('2026-08-25');
  await ui.getByRole('button', { name: '保存操作日期', exact: true }).click();
  await expect(ui.getByText('当前操作日期：2026-08-25', { exact: false })).toBeVisible();
  await ui.reload();
  await expect(ui.locator('input[type="date"]')).toHaveValue('2026-08-25');
  const other = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId,
    userCode: 'admin',
    password: 'admin',
  });
  const otherDate = await callApi<{ date: string }>(
    request,
    'm.system-admin.operationDate.get',
    undefined,
    { token: other.token, method: 'GET' },
  );
  expect(otherDate.date).not.toBe('2026-08-25');
  await ui.close();
});

test('w_xt_kgzb_1 / _2 完整初始化：取消不改原账，双确认后保留身份、重建期间并重新登录', async ({
  page,
  context,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const ui = await context.newPage();
  await login(ui, bookId);
  const beforeToken = await token(ui);
  const original = await callApi<{ book: { name: string } }>(request, 'core.auth.me', undefined, {
    token: beforeToken,
    method: 'GET',
  });
  await ui.goto('/m/system-admin/reset');
  await ui.getByLabel('初始化后的账套名称', { exact: true }).fill('完整初始化合成账套');
  await ui.getByLabel('单位名称', { exact: true }).fill('初始化后合成单位');
  await ui.getByLabel('科目级次', { exact: true }).fill('4-3-3');
  await ui.getByLabel('开账年度', { exact: true }).fill('2027');
  await ui.getByLabel('启用月份', { exact: true }).fill('6');
  await ui.getByLabel('当前管理员密码', { exact: true }).fill('admin');
  await ui.getByRole('button', { name: '预览初始化内容', exact: true }).click();
  await expect(ui.getByText(`即将初始化「${original.book.name}」`, { exact: true })).toBeVisible();
  await ui.getByLabel('输入当前账套完整名称确认', { exact: true }).fill(original.book.name);
  await ui.getByRole('button', { name: '执行完整重新初始化', exact: true }).click();
  let dialog = ui.getByRole('dialog', { name: '再次确认完整重新初始化', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    (
      await callApi<{ book: { name: string } }>(request, 'core.auth.me', undefined, {
        token: beforeToken,
        method: 'GET',
      })
    ).book.name,
  ).toBe(original.book.name);
  await ui.getByRole('button', { name: '执行完整重新初始化', exact: true }).click();
  dialog = ui.getByRole('dialog', { name: '再次确认完整重新初始化', exact: true });
  await dialog.getByLabel('确认文字', { exact: true }).fill('重新初始化');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(ui).toHaveURL(`/login/${bookId}`);
  await expect(
    callApi(request, 'core.auth.me', undefined, { token: beforeToken, method: 'GET' }),
  ).rejects.toThrow('登录已失效');
  await login(ui, bookId, '2027-06-01');
  const afterToken = await token(ui);
  const after = await callApi<{
    book: { id: string; name: string; orgName: string; startPeriod: number; codeScheme: number[] };
  }>(request, 'core.auth.me', undefined, { token: afterToken, method: 'GET' });
  expect(after.book).toMatchObject({
    id: bookId,
    name: '完整初始化合成账套',
    orgName: '初始化后合成单位',
    startPeriod: 202706,
    codeScheme: [4, 3, 3],
  });
  expect(
    (
      await callApi<{ total: number }>(
        request,
        'core.vouchers.list',
        {},
        { token: afterToken, method: 'GET' },
      )
    ).total,
  ).toBe(0);
  await ui.close();
});

test('w_xt_users 关闭标签保存失败仍保留全部输入，重试保存后才关闭，服务端仅保存一次', async ({
  page,
  context,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const ui = await context.newPage();
  await login(ui, bookId);
  await ui.goto('/m/system-admin/users');
  await ui.getByRole('button', { name: '新增用户', exact: true }).click();
  const drawer = ui.getByRole('dialog', { name: '新增用户', exact: true });
  await drawer.getByLabel('用户编号', { exact: true }).fill('unsaved-user');
  await drawer.getByLabel('用户名称', { exact: true }).fill('未保存输入');
  await drawer.getByLabel('新密码', { exact: true }).fill('synthetic123');
  await drawer.getByLabel('确认新密码', { exact: true }).fill('synthetic123');
  await ui.route('**/trpc/*m.system-admin.users.create*', (route) => route.abort('failed'));
  await ui.keyboard.press('Control+F4');
  let guard = ui.getByRole('dialog', { name: '有未保存内容', exact: true });
  await guard.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(guard).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('用户名称', { exact: true })).toHaveValue('未保存输入');
  await ui.unroute('**/trpc/*m.system-admin.users.create*');
  await ui.keyboard.press('Control+F4');
  guard = ui.getByRole('dialog', { name: '有未保存内容', exact: true });
  await guard.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(ui).toHaveURL(/\/home$/);
  const users = await callApi<{ code: string }[]>(request, 'm.system-admin.users.list', undefined, {
    token: await token(ui),
    method: 'GET',
  });
  expect(users.filter((user) => user.code === 'unsaved-user')).toHaveLength(1);
  await ui.close();
});

test('w_xt_kgzb 取消预览及离开放弃调用受管清理；清理请求失败保留预览并可重试', async ({
  page,
  context,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const ui = await context.newPage();
  await login(ui, bookId);
  await ui.goto('/m/system-admin/reset');
  await ui.getByLabel('当前管理员密码', { exact: true }).fill('admin');
  await ui.getByRole('button', { name: '预览初始化内容', exact: true }).click();
  await expect(ui.getByRole('button', { name: '执行完整重新初始化', exact: true })).toBeVisible();
  await ui.route('**/trpc/*m.system-admin.reset.cancel*', (route) => route.abort('failed'));
  await ui.getByRole('button', { name: '取消初始化预览', exact: true }).click();
  await expect(
    ui.getByText('初始化暂存未能清理，请重试取消；原账套及保护副本保留', { exact: true }),
  ).toBeVisible();
  await expect(ui.getByRole('button', { name: '执行完整重新初始化', exact: true })).toBeHidden();
  await expect(ui.getByRole('button', { name: '取消初始化预览', exact: true })).toBeVisible();
  await ui.unroute('**/trpc/*m.system-admin.reset.cancel*');
  const cancelled = ui.waitForResponse(
    (response) => response.url().includes('m.system-admin.reset.cancel') && response.ok(),
  );
  await ui.getByRole('button', { name: '取消初始化预览', exact: true }).click();
  await cancelled;
  await expect(ui.getByRole('button', { name: '执行完整重新初始化', exact: true })).toBeHidden();
  await ui.getByRole('button', { name: '预览初始化内容', exact: true }).click();
  await expect(ui.getByRole('button', { name: '执行完整重新初始化', exact: true })).toBeVisible();
  const discarded = ui.waitForResponse(
    (response) => response.url().includes('m.system-admin.reset.cancel') && response.ok(),
  );
  await ui.keyboard.press('Control+F4');
  const guard = ui.getByRole('dialog', { name: '有未保存内容', exact: true });
  await guard.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await discarded;
  await expect(ui).toHaveURL(/\/home$/);
  expect(
    (
      await callApi<{ book: { id: string } }>(request, 'core.auth.me', undefined, {
        token: await token(ui),
        method: 'GET',
      })
    ).book.id,
  ).toBe(bookId);
  await ui.close();
});
