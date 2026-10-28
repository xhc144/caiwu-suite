import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_SETTINGS } from '../shared';

test('w_bf → w_hf 新副本恢复：真实备份、修改设置、安全新副本、重新登录并核对', async ({
  page,
  request,
}) => {
  const original = await loginWithNewBook(page, request);
  await callApi(
    request,
    'm.backup.saveSettings',
    { ...DEFAULT_SETTINGS, intervalMinutes: 15 },
    { token: original.token },
  );
  await page.goto('/m/backup/');
  await expect(page.getByRole('heading', { name: '备份恢复' })).toBeVisible();
  await expect(
    page.getByText('已启用自动备份：本地服务按启动、定时和正常退出设置执行'),
  ).toBeVisible();
  await page.getByLabel('备份名称', { exact: true }).fill('阶段完整备份');
  await page.getByRole('button', { name: '开始备份', exact: true }).click();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByText('阶段完整备份', { exact: true }) });
  await expect(row).toContainText('校验通过');
  const downloadEvent = page.waitForEvent('download');
  await row.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.caiwubak$/);
  await callApi(
    request,
    'm.backup.saveSettings',
    { ...DEFAULT_SETTINGS, intervalMinutes: 120 },
    { token: original.token },
  );
  await page.getByLabel('副本名称', { exact: true }).fill('阶段恢复副本');
  await row.getByRole('button', { name: '恢复预览', exact: true }).click();
  await expect(page.getByText(original.bookName, { exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByText('启用 / 当前期间', { exact: true }) })
      .getByText('202601 / 202601', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('恢复确认文字', { exact: true }).fill('恢复副本 阶段恢复副本');
  await page.getByLabel('管理员密码', { exact: true }).fill('admin');
  const restoreResponse = page.waitForResponse(
    (r) => r.url().includes('m.backup.restore') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '确认恢复为新账套', exact: true }).click();
  await restoreResponse;
  await expect(page.getByRole('heading', { name: '已恢复为新账套' })).toBeVisible();
  await expect(
    callApi(request, 'm.backup.list', undefined, { token: original.token, method: 'GET' }),
  ).rejects.toThrow('登录已失效');
  const books = await callApi<{ id: string; name: string }[]>(
    request,
    'core.books.list',
    undefined,
    { method: 'GET' },
  );
  const restored = books.find((b) => b.name === '阶段恢复副本')!;
  expect(restored.id).not.toBe(original.bookId);
  // loginWithNewBook 的 init script 会在每次导航重放原会话，测试在真实重登前清除。
  await page.addInitScript(() => sessionStorage.removeItem('caiwu.session'));
  await page.getByRole('button', { name: '重新登录', exact: true }).click();
  await page.goto(`/login/${restored.id}`);
  await page.getByLabel('密码', { exact: true }).fill('admin');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('menuitem', { name: '备份恢复', exact: true }).click();
  await expect(page.getByRole('heading', { name: '备份恢复' })).toBeVisible();
  await expect(page.getByLabel('定时间隔 / 分钟')).toHaveValue('15');
  const fresh = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: original.bookId,
    userCode: 'admin',
    password: 'admin',
  });
  const current = await callApi<{ config: { intervalMinutes: number } }>(
    request,
    'm.backup.overview',
    undefined,
    { token: fresh.token, method: 'GET' },
  );
  expect(current.config.intervalMinutes).toBe(120);
});

test('w_tzjl_get_all：浏览器多包逐个预检，坏包逐项显示原因，合法包可预览', async ({
  page,
  request,
}) => {
  const original = await loginWithNewBook(page, request);
  await page.goto('/m/backup/');
  await page.getByLabel('上传备份包', { exact: true }).setInputFiles([
    {
      name: '错误备份.caiwubak',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('wrong legacy backup'),
    },
  ]);
  await expect(
    page.getByRole('row').filter({ has: page.getByText('错误备份.caiwubak', { exact: true }) }),
  ).toContainText('拒绝');
  const item = await callApi<{ id: string }>(
    request,
    'm.backup.create',
    { name: '上传源', requestId: crypto.randomUUID() },
    { token: original.token },
  );
  await expect
    .poll(async () => {
      const list = await callApi<{ id: string; status: string }[]>(
        request,
        'm.backup.list',
        undefined,
        { token: original.token, method: 'GET' },
      );
      return list.find((r) => r.id === item.id)?.status;
    })
    .toBe('valid');
  const pack = await callApi<{ base64: string }>(
    request,
    'm.backup.download',
    { id: item.id },
    { token: original.token },
  );
  await page.getByLabel('上传备份包', { exact: true }).setInputFiles([
    {
      name: '合法包.caiwubak',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(pack.base64, 'base64'),
    },
    { name: '损坏包.caiwubak', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') },
    {
      name: '重复包.caiwubak',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(pack.base64, 'base64'),
    },
  ]);
  await expect(
    page.getByRole('row').filter({ has: page.getByText('合法包.caiwubak', { exact: true }) }),
  ).toContainText('预检通过');
  await expect(
    page.getByRole('row').filter({ has: page.getByText('损坏包.caiwubak', { exact: true }) }),
  ).toContainText('拒绝');
  await expect(
    page.getByRole('row').filter({ has: page.getByText('重复包.caiwubak', { exact: true }) }),
  ).toContainText('重复来源 ID');
});
