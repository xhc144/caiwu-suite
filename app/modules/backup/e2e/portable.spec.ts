import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { callApi, E2E_APP_TOKEN, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_SETTINGS } from '../shared';

test('w_tzjl_get：只携带备份包到第二台合成电脑，浏览器上传预览、恢复新副本并登录', async ({
  page,
  request,
  browser,
  playwright,
}) => {
  const source = await loginWithNewBook(page, request, { name: `换机来源-${randomUUID()}` });
  await callApi(
    request,
    'm.backup.saveSettings',
    { ...DEFAULT_SETTINGS, intervalMinutes: 19 },
    { token: source.token },
  );
  const item = await callApi<{ id: string }>(
    request,
    'm.backup.create',
    { requestId: randomUUID(), name: '换机包' },
    { token: source.token },
  );
  await expect
    .poll(
      async () =>
        (
          await callApi<{ id: string; status: string }[]>(request, 'm.backup.list', undefined, {
            token: source.token,
            method: 'GET',
          })
        ).find((r) => r.id === item.id)?.status,
    )
    .toBe('valid');
  const portable = await callApi<{ base64: string }>(
    request,
    'm.backup.download',
    { id: item.id },
    { token: source.token },
  );
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'backup-second-machine-'));
  const server = spawnLocalServer({
    dataDir,
    shutdownProtocol: 'native',
    env: {
      CAIWU_PORT: '0',
      CAIWU_TOKEN: E2E_APP_TOKEN,
      CAIWU_DEV: '1',
      CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
    },
  });
  const port = await server.ready();
  const baseURL = `http://127.0.0.1:${port}`;
  const secondRequest = await playwright.request.newContext({ baseURL });
  const context = await browser.newContext({ baseURL });
  const second = await context.newPage();
  let closed = false;
  try {
    const destination = await loginWithNewBook(second, secondRequest, { name: '换机接收账套' });
    await second.goto('/m/backup/');
    await second.getByLabel('上传备份包', { exact: true }).setInputFiles({
      name: '携带包.caiwubak',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(portable.base64, 'base64'),
    });
    await expect(
      second.getByRole('row').filter({ has: second.getByText('携带包.caiwubak', { exact: true }) }),
    ).toContainText('预检通过');
    await expect(second.getByText(source.bookName, { exact: true })).toBeVisible();
    await expect(
      second
        .getByRole('row')
        .filter({ has: second.getByText('启用 / 当前期间', { exact: true }) })
        .getByText('202601 / 202601', { exact: true }),
    ).toBeVisible();
    const copyName = `${source.bookName}（恢复副本）`;
    await second.getByLabel('恢复确认文字', { exact: true }).fill(`恢复副本 ${copyName}`);
    await second.getByLabel('管理员密码', { exact: true }).fill('admin');
    await second.getByRole('button', { name: '确认恢复为新账套', exact: true }).click();
    await expect(
      second.getByRole('heading', { name: '已恢复为新账套', exact: true }),
    ).toBeVisible();
    const books = await callApi<{ id: string; name: string }[]>(
      secondRequest,
      'core.books.list',
      undefined,
      { method: 'GET' },
    );
    const restored = books.find((b) => b.name === copyName)!;
    expect(restored.id).not.toBe(source.bookId);
    expect(restored.id).not.toBe(destination.bookId);
    await second.addInitScript(() => sessionStorage.removeItem('caiwu.session'));
    await second.getByRole('button', { name: '重新登录', exact: true }).click();
    await second.goto(`/login/${restored.id}`);
    await second.getByLabel('密码', { exact: true }).fill('admin');
    await second.getByRole('button', { name: '登录', exact: true }).click();
    await expect(second).toHaveURL(/\/home$/);
    await second.getByRole('menuitem', { name: '备份恢复', exact: true }).click();
    await expect(second.getByLabel('定时间隔 / 分钟', { exact: true })).toHaveValue('19');
    await expect(second.getByText('换机包', { exact: true })).toHaveCount(0);
    // 原机器的会话仍有效，原账套不受第二机器恢复影响。
    expect(
      await callApi(request, 'm.backup.list', undefined, { token: source.token, method: 'GET' }),
    ).toHaveLength(1);
    await server.close();
    closed = true;
  } finally {
    await context.close();
    await secondRequest.dispose();
    if (!closed) await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
