import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { callApi, E2E_APP_TOKEN, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_SETTINGS } from '../shared';

type Isolated = { page: Page; request: APIRequestContext; dataDir: string };
const test = base.extend<{ isolated: Isolated }>({
  isolated: async ({ browser, playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'backup-history-ui-'));
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
    const request = await playwright.request.newContext({ baseURL });
    const context = await browser.newContext({ baseURL });
    try {
      await use({ page: await context.newPage(), request, dataDir });
    } finally {
      await context.close();
      await request.dispose();
      await server.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});

for (const fault of ['缺失普通包', '缺失历史保护包', '损坏旧包'] as const) {
  test(`w_hf：${fault}阻止准备，页面独立校验后重新预览可真实恢复`, async ({ isolated }) => {
    const { page, request, dataDir } = isolated;
    const book = await loginWithNewBook(page, request);
    const api = <T>(procedure: string, input?: unknown, method?: 'GET' | 'POST') =>
      callApi<T>(request, procedure, input, { token: book.token, method });
    const list = () =>
      api<{ id: string; name: string; status: string; directory: string }[]>(
        'm.backup.list',
        undefined,
        'GET',
      );
    const create = async (name: string) => {
      const row = await api<{ id: string }>('m.backup.create', {
        requestId: randomUUID(),
        name,
      });
      await expect
        .poll(async () => (await list()).find((r) => r.id === row.id)?.status)
        .toBe('valid');
      return row.id;
    };
    await api('m.backup.saveSettings', { ...DEFAULT_SETTINGS, intervalMinutes: 17 });
    const sourceId = await create('本次完好来源');
    let historicalId: string;
    if (fault === '缺失历史保护包') {
      const plan = await api<{ id: string }>('m.backup.preview', {
        id: sourceId,
        purpose: 'overwrite',
      });
      const protection = await api<{ protectionId: string }>('m.backup.prepareOverwrite', {
        planId: plan.id,
      });
      historicalId = protection.protectionId;
      await api('m.backup.cancelPlan', { id: plan.id });
    } else historicalId = await create('待检查历史普通包');
    const historical = (await list()).find((r) => r.id === historicalId)!;
    const file = path.join(
      dataDir,
      'backups',
      book.bookId,
      historical.directory,
      `${historicalId}.caiwubak`,
    );
    if (fault === '损坏旧包') await writeFile(file, '合成损坏备份');
    else await rm(file);
    await api('m.backup.saveSettings', { ...DEFAULT_SETTINGS, intervalMinutes: 121 });
    await page.goto('/m/backup/');
    await page.getByRole('radio', { name: '覆盖当前账套（先生成保护备份）', exact: true }).check();
    const source = page
      .getByRole('row')
      .filter({ has: page.getByText('本次完好来源', { exact: true }) });
    await source.getByRole('button', { name: '恢复预览', exact: true }).click();
    await page.getByRole('button', { name: '先生成恢复前保护备份', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '确认覆盖当前账套', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(`本机历史备份「${historical.name}」未通过校验，覆盖准备已停止`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/请取消本次恢复，在备份列表对/)).toBeVisible();
    await page.getByRole('button', { name: '取消恢复', exact: true }).click();
    const history = page.locator(`tr[data-row-key="${historicalId}"]`);
    await history.getByRole('button', { name: '校验', exact: true }).click();
    await expect(history).toContainText('校验失败');
    if (fault === '缺失历史保护包')
      await expect(history.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
    await source.getByRole('button', { name: '恢复预览', exact: true }).click();
    await page.getByRole('button', { name: '先生成恢复前保护备份', exact: true }).click();
    await expect(page.getByText(/保护备份：backups\//)).toBeVisible();
    await page.getByLabel('恢复确认文字', { exact: true }).fill(`覆盖 ${book.bookName}`);
    await page.getByLabel('管理员密码', { exact: true }).fill('admin');
    await page.getByRole('button', { name: '确认覆盖当前账套', exact: true }).click();
    await expect(page.getByRole('heading', { name: '已覆盖恢复账套', exact: true })).toBeVisible();
    const login = await callApi<{ token: string }>(request, 'core.auth.login', {
      bookId: book.bookId,
      userCode: 'admin',
      password: 'admin',
    });
    const restored = await callApi<{ config: { intervalMinutes: number } }>(
      request,
      'm.backup.overview',
      undefined,
      { token: login.token, method: 'GET' },
    );
    expect(restored.config.intervalMinutes).toBe(17);
    const retained = await callApi<{ id: string; status: string }[]>(
      request,
      'm.backup.list',
      undefined,
      { token: login.token, method: 'GET' },
    );
    expect(retained.find((r) => r.id === sourceId)?.status).toBe('valid');
    if (fault === '损坏旧包') expect(await readFile(file, 'utf8')).toBe('合成损坏备份');
  });
}
