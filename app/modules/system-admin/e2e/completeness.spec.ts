import { callApi } from '@caiwu/testkit/e2e';
import { expect, test } from './fixture';
import type { CheckItem } from '../shared';

test('w_zh_zhjc 独立 core 造数，真实入口定位期初外币及数量异常，合法分录通过', async ({
  page,
  isolated,
}) => {
  const opts = { token: isolated.token, method: 'GET' as const };
  const before = await callApi(
    isolated.request,
    'core.vouchers.get',
    { id: isolated.voucherId },
    opts,
  );
  await page.goto(`${isolated.baseURL}/m/system-admin/check`);
  await expect(page.getByRole('heading', { name: '综合检查', exact: true })).toBeVisible();
  const failed = page.getByRole('row').filter({ hasText: '非数量科目存有数量' });
  await expect(failed).toContainText('1001 / 期初 ID');
  await expect(failed).toContainText('币种与科目外币核算设置不符');
  await expect(failed).toContainText('不通过');
  const checks = await callApi<CheckItem[]>(
    isolated.request,
    'm.system-admin.checks',
    undefined,
    opts,
  );
  expect(checks.filter((r) => r.category === '分录核算项')).toHaveLength(4);
  expect(checks.filter((r) => r.category === '分录核算项').every((r) => r.status === '通过')).toBe(
    true,
  );
  await page.getByRole('button', { name: '重新检查', exact: true }).click();
  await expect(failed).toBeVisible();
  expect(
    await callApi(isolated.request, 'core.vouchers.get', { id: isolated.voucherId }, opts),
  ).toEqual(before);
  // 响应失败不能把空表及“不通过 0 项”当成成功结果。
  await page.route('**/trpc/m.system-admin.checks*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '重新检查', exact: true }).click();
  await expect(page.getByText('本次检查未能完成', { exact: true })).toBeVisible();
  await expect(page.getByText(/不通过：0/)).toHaveCount(0);
});

test('w_bf_98001 独立已过账合成凭证经 UI 下载可追溯文件，不泄露未关联用户或凭据', async ({
  page,
  isolated,
}) => {
  const options = { token: isolated.token };
  await callApi(
    isolated.request,
    'm.system-admin.users.create',
    {
      code: 'unrelated',
      name: '不应导出人员',
      password: 'synthetic123',
      confirmPassword: 'synthetic123',
    },
    options,
  );
  await page.goto(`${isolated.baseURL}/m/system-admin/audit`);
  await page.getByRole('button', { name: '预览数据数量', exact: true }).click();
  await expect(page.getByText('凭证关联操作员', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '确认导出通用资料', exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  const file = JSON.parse(text) as {
    format: string;
    totals: { debit: number; credit: number };
    operators: unknown[];
    vouchers: Record<string, unknown>[];
  };
  expect(file.format).toBe('通用审计资料 v2');
  expect(file.totals.debit).toBe(1000);
  expect(file.totals.credit).toBe(1000);
  expect(file.operators).toEqual([{ id: 1, code: 'admin', name: '系统管理员', disabled: 0 }]);
  expect(file.vouchers[0]).toMatchObject({
    id: isolated.voucherId,
    status: 'posted',
    revision: expect.any(Number),
    created_at: expect.any(String),
    posted_at: expect.any(String),
  });
  expect(text).not.toMatch(/不应导出人员|synthetic123|password_hash|scrypt\$|user_permission/);
});

test('w_grant 权限查找不丢失已选项，强确认取消不变，保存后旧会话失效', async ({
  page,
  isolated,
}) => {
  const admin = { token: isolated.token };
  const created = await callApi<{ id: number; code: string }>(
    isolated.request,
    'm.system-admin.users.create',
    {
      code: 'finder',
      name: '权限查找测试',
      password: 'finder123',
      confirmPassword: 'finder123',
      permissions: ['system-admin.password'],
    },
    admin,
  );
  const clerk = await callApi<{ token: string }>(isolated.request, 'core.auth.login', {
    bookId: isolated.bookId,
    userCode: 'finder',
    password: 'finder123',
  });
  await page.goto(`${isolated.baseURL}/m/system-admin/users`);
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'finder', exact: true }) })
    .getByRole('button', { name: '权限', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '用户权限 finder', exact: true });
  await expect(drawer.getByText(/已选 1 \//)).toBeVisible();
  await drawer.getByRole('textbox', { name: '查找功能权限', exact: true }).fill('运行综合检查');
  await expect(drawer.getByText(/匹配 1 项；查找不会改变授权/)).toBeVisible();
  await drawer
    .locator('.ant-tree-treenode')
    .filter({ has: page.getByText('运行综合检查', { exact: true }) })
    .locator('.ant-tree-checkbox')
    .click();
  await expect(drawer.getByText(/已选 2 \//)).toBeVisible();
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  let confirm = page.getByRole('dialog').filter({ has: page.getByLabel('确认文字') });
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirm).toBeHidden();
  const original = await callApi<{ permissions: string[] }>(
    isolated.request,
    'm.system-admin.users.permissions',
    { id: created.id },
    { ...admin, method: 'GET' },
  );
  expect(original.permissions).toEqual(['system-admin.password']);
  await callApi(isolated.request, 'core.auth.me', undefined, { token: clerk.token, method: 'GET' });
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  confirm = page.getByRole('dialog').filter({ has: page.getByLabel('确认文字') });
  await confirm.getByLabel('确认文字').fill('finder');
  await confirm.getByRole('button', { name: '确定', exact: true }).click();
  await expect(drawer).toBeHidden();
  const next = await callApi<{ permissions: string[] }>(
    isolated.request,
    'm.system-admin.users.permissions',
    { id: created.id },
    { ...admin, method: 'GET' },
  );
  expect(next.permissions.sort()).toEqual(['system-admin.check', 'system-admin.password']);
  await expect(
    callApi(isolated.request, 'core.auth.me', undefined, { token: clerk.token, method: 'GET' }),
  ).rejects.toThrow('登录已失效');
});

test('w_grant 权限资料读取失败时明确提示并禁止保存，旧授权不变', async ({ page, isolated }) => {
  const admin = { token: isolated.token };
  const user = await callApi<{ id: number }>(
    isolated.request,
    'm.system-admin.users.create',
    {
      code: 'read-error',
      name: '读取失败测试',
      password: 'synthetic123',
      confirmPassword: 'synthetic123',
      permissions: ['system-admin.password'],
    },
    admin,
  );
  await page.goto(`${isolated.baseURL}/m/system-admin/users`);
  // tRPC 可将模块清单与权限读取合并在同一 URL；必须拦截实际批处理请求。
  await page.route('**/trpc/*m.system-admin.users.permissions*', (route) => route.abort('failed'));
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'read-error', exact: true }) })
    .getByRole('button', { name: '权限', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '用户权限 read-error', exact: true });
  await expect(
    drawer.getByText('权限资料读取失败，请关闭后重新打开；本次不能保存。', { exact: true }),
  ).toBeVisible();
  await expect(drawer.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  const saved = await callApi<{ permissions: string[] }>(
    isolated.request,
    'm.system-admin.users.permissions',
    { id: user.id },
    { ...admin, method: 'GET' },
  );
  expect(saved.permissions).toEqual(['system-admin.password']);
});
