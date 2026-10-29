import { expect, test, type Page } from '@playwright/test';
import { callApi, E2E_APP_TOKEN, loginWithNewBook } from '@caiwu/testkit/e2e';
import Database from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function login(page: Page, bookId: string, code: string, password: string) {
  await page.goto(`/login/${bookId}`);
  await page.getByLabel('用户编号').fill(code);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('密码', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/home$/);
}
async function token(page: Page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('caiwu.session')!).token as string);
}
async function confirmation(page: Page, text: string) {
  const modal = page.getByRole('dialog').filter({ has: page.getByLabel('确认文字') });
  await modal.getByLabel('确认文字').fill(text);
  await modal.getByRole('button', { name: '确定', exact: true }).click();
}
async function switchUser(page: Page) {
  await page.goto('/m/system-admin/switch');
  await page.getByRole('button', { name: '确认并切换用户' }).click();
  await confirmation(page, '切换用户');
  await expect(page).toHaveURL(/\/login\//);
}
async function grant(page: Page, code: string, names: string[]) {
  await page.goto('/m/system-admin/users');
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: code, exact: true }) })
    .getByRole('button', { name: '权限', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: `用户权限 ${code}`, exact: true });
  await expect(drawer.getByText('权限来自当前已加载模块')).toBeVisible();
  for (const name of names)
    await drawer
      .locator('.ant-tree-treenode')
      .filter({ has: page.getByText(name, { exact: true }) })
      .locator('.ant-tree-checkbox')
      .click();
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await confirmation(page, code);
  await expect(drawer).toBeHidden();
}

test('w_login → w_xt_users → w_grant → w_pass：真实 UI 授权、直接 HTTP 拒绝和密码会话失效', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(90000);
  const { bookId } = await loginWithNewBook(page, request);
  // 使用新页面做真实登录，避免 testkit 初始化脚本在整页刷新时注入旧管理员会话。
  const ui = await context.newPage();
  await login(ui, bookId, 'admin', 'admin');
  await ui.goto('/m/system-admin/users');
  await ui.getByRole('button', { name: '新增用户', exact: true }).click();
  const drawer = ui.getByRole('dialog', { name: '新增用户', exact: true });
  await drawer.getByLabel('用户编号', { exact: true }).fill('m17clerk');
  await drawer.getByLabel('用户名称').fill('系统测试操作员');
  await drawer.getByLabel('新密码', { exact: true }).fill('clerkpass123');
  await drawer.getByLabel('确认新密码').fill('clerkpass123');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).toBeHidden();
  await grant(ui, 'm17clerk', ['进入系统管理与切换用户', '修改本人密码']);
  const adminToken = await token(ui);
  await switchUser(ui);
  await expect(callApi(request, 'core.auth.me', undefined, { token: adminToken })).rejects.toThrow(
    /登录已失效/,
  );
  await login(ui, bookId, 'm17clerk', 'clerkpass123');
  const clerkToken = await token(ui);
  await expect(ui.getByRole('menuitem', { name: /综合检查/ })).toHaveCount(0);
  await expect(ui.getByRole('menuitem', { name: /用户管理/ })).toHaveCount(0);
  // 配置会在 worker 重新求值；只在 E2E 临时目录中定位本测试的唯一合成账套。
  const bookFiles = readdirSync(os.tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^caiwu-e2e-\d+-\d+$/.test(entry.name))
    .map((entry) => path.join(os.tmpdir(), entry.name, 'books', `${bookId}.caiwu`))
    .filter(existsSync);
  expect(bookFiles).toHaveLength(1);
  const db = new Database(bookFiles[0]!, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    // 同一只读连接的版本会随其他连接的提交变化，拒绝请求和拒绝页均不得写库。
    const version = db.pragma('data_version', { simple: true });
    const denied = await request.get('/trpc/m.system-admin.checks', {
      headers: { 'x-caiwu-token': E2E_APP_TOKEN, authorization: `Bearer ${clerkToken}` },
    });
    expect(denied.status()).toBe(403);
    const body: unknown = await denied.json();
    expect(body).toMatchObject({
      error: {
        data: {
          code: 'FORBIDDEN',
          httpStatus: 403,
          business: {
            code: 'FORBIDDEN',
            message: expect.stringMatching(/没有.*综合检查/),
            details: { permission: 'system-admin.check' },
          },
        },
      },
    });
    expect(body).not.toHaveProperty('result');
    expect(db.pragma('data_version', { simple: true })).toBe(version);
    // 壳在加载模块页之前拒绝直达地址，检查界面和操作均不可用。
    await ui.goto('/m/system-admin/check');
    await expect(ui.getByText('无权访问此页面', { exact: true })).toBeVisible();
    await expect(ui.getByRole('heading', { name: '综合检查', exact: true })).toHaveCount(0);
    await expect(ui.getByRole('button', { name: '重新检查', exact: true })).toHaveCount(0);
    expect(db.pragma('data_version', { simple: true })).toBe(version);
  } finally {
    db.close();
  }
  await switchUser(ui);
  await login(ui, bookId, 'admin', 'admin');
  await grant(ui, 'm17clerk', ['运行综合检查']);
  await switchUser(ui);
  await login(ui, bookId, 'm17clerk', 'clerkpass123');
  await expect(ui.getByRole('menuitem', { name: /综合检查/ })).toBeVisible();
  const nextToken = await token(ui);
  const checks = await callApi<unknown[]>(request, 'm.system-admin.checks', undefined, {
    token: nextToken,
    method: 'GET',
  });
  expect(checks.length).toBeGreaterThan(0);
  await ui.goto('/m/system-admin/password');
  await ui.getByLabel('原密码', { exact: true }).fill('clerkpass123');
  await ui.getByLabel('新密码', { exact: true }).fill('clerkpass456');
  await ui.getByLabel('确认新密码', { exact: true }).fill('clerkpass456');
  await ui.getByRole('button', { name: '保存新密码并重新登录' }).click();
  await expect(ui).toHaveURL(new RegExp(`/login/${bookId}$`));
  expect(await ui.evaluate(() => sessionStorage.getItem('caiwu.session'))).toBeNull();
  await expect(callApi(request, 'core.auth.me', undefined, { token: nextToken })).rejects.toThrow(
    /登录已失效/,
  );
  await login(ui, bookId, 'm17clerk', 'clerkpass456');
  await expect(ui.getByRole('menuitem', { name: /综合检查/ })).toBeVisible();
  await ui.close();
});

test('w_bf_98001 / w_xt_kgzb：预览、取消、真实下载和初始化参数预览', async ({
  page,
  context,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const ui = await context.newPage();
  await login(ui, bookId, 'admin', 'admin');
  await ui.goto('/m/system-admin/audit');
  await ui.getByRole('button', { name: '预览数据数量' }).click();
  await expect(ui.getByRole('heading', { name: /导出前确认/ })).toBeVisible();
  await ui.getByRole('button', { name: '取消导出' }).click();
  await expect(ui.getByRole('button', { name: '确认导出通用资料' })).toHaveCount(0);
  await ui.getByRole('button', { name: '预览数据数量' }).click();
  const downloadPromise = ui.waitForEvent('download');
  await ui.getByRole('button', { name: '确认导出通用资料' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('通用审计资料-2026.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const file = Buffer.concat(chunks).toString('utf8');
  expect(() => JSON.parse(file) as unknown).not.toThrow();
  expect(file).not.toMatch(/password_hash|scrypt\$|token/);
  await ui.goto('/m/system-admin/reset');
  await expect(ui.getByText('初始化会清除当前账套全部业务数据', { exact: true })).toBeVisible();
  await expect(ui.getByRole('button', { name: '预览初始化内容' })).toBeEnabled();
  await expect(ui.getByRole('button', { name: '执行完整重新初始化' })).toHaveCount(0);
  await expect(ui.getByLabel('单位名称', { exact: true })).toHaveValue('E2E 测试单位');
  await ui.close();
});

test('w_login 缺失账套可返回选择，键盘重复提交只产生一次真实登录请求', async ({
  page,
  context,
  request,
}) => {
  const { bookId } = await loginWithNewBook(page, request);
  const ui = await context.newPage();
  await ui.goto('/login/not-a-book');
  await expect(ui.getByText('账套不存在，可能已删除', { exact: true })).toBeVisible();
  await ui.getByRole('button', { name: '返回账套列表', exact: true }).click();
  await expect(ui.getByText('选择账套', { exact: true })).toBeVisible();
  await ui.goto(`/login/${bookId}`);
  await ui.getByLabel('密码', { exact: true }).fill('admin');
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  let count = 0;
  await ui.route('**/trpc/core.auth.login*', async (route) => {
    count++;
    started();
    await gate;
    await route.continue();
  });
  try {
    await ui.getByLabel('密码', { exact: true }).press('Enter');
    await pending;
    await ui.getByLabel('密码', { exact: true }).press('Enter');
    await ui.getByLabel('密码', { exact: true }).press('Enter');
    expect(count).toBe(1);
  } finally {
    release();
  }
  await expect(ui).toHaveURL(/\/home$/);
  await ui.close();
});
