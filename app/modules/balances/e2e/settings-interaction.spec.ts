import { expect } from '@playwright/test';
import { callApi, createBook, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Settings } from '../shared';
import { test } from './fixture';
import { chooseSettingsClose } from './settings-dialog';

test('w_zw_fhye_1：重复继续/放弃、取消刷新与确认离开保稿，查询选择仍属原账套', async ({
  page,
  localServer,
}) => {
  const { bookId, token, bookName } = await loginWithNewBook(page, localServer.request);
  const other = await createBook(localServer.request);
  const otherLogin = await callApi<{ token: string }>(localServer.request, 'core.auth.login', {
    bookId: other.bookId,
    userCode: 'admin',
    password: 'admin',
  });
  await callApi(
    localServer.request,
    'm.balances.saveSettings',
    { revision: 0, display: { level: 3, onlyActivity: true } },
    { token: otherLogin.token, method: 'POST' },
  );
  const saves: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('m.balances.saveSettings')) saves.push(request.url());
  });
  const url = `${localServer.url}/m/balances/auxiliary?dimension=department&dimensionFrom=01&dimensionTo=02&from=202602&to=202602`;
  await page.goto(url);
  const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await drawer.getByLabel('默认显示级次').selectOption('-1');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await chooseSettingsClose(page, '继续编辑', 2);
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');

  const cancelled = page.waitForEvent('dialog');
  const reloadCancelled = page.evaluate(() => window.location.reload());
  const stay = await cancelled;
  expect(stay.type()).toBe('beforeunload');
  await stay.dismiss();
  await reloadCancelled;
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
  await expect(page).toHaveURL(url);

  const accepted = page.waitForEvent('dialog');
  const reloadAccepted = page.reload();
  const leave = await accepted;
  expect(leave.type()).toBe('beforeunload');
  await leave.accept();
  await reloadAccepted;
  await expect(drawer).toHaveCount(0);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await expect(drawer.getByRole('status')).toContainText('已恢复');
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await chooseSettingsClose(page, '放弃修改', 2);
  await expect(drawer).toHaveCount(0);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('1');
  await expect(drawer.getByRole('status')).toHaveCount(0);
  await expect(page.getByText(bookName, { exact: true })).toBeVisible();
  await expect(page.getByLabel('核算类型', { exact: true })).toHaveValue('department');
  await expect(page.getByTitle('01 行政部', { exact: true })).toBeVisible();
  await expect(page.getByTitle('02 销售部', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(url);
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('caiwu.session')!).bookId),
  ).toBe(bookId);
  for (const [sessionToken, level] of [
    [token, 1],
    [otherLogin.token, 3],
  ] as const) {
    const metadata = await callApi<{ settings: Settings }>(
      localServer.request,
      'm.balances.metadata',
      undefined,
      { token: sessionToken, method: 'GET' },
    );
    expect(metadata.settings.display.level).toBe(level);
  }
  expect(saves).toHaveLength(0);
});

test('w_zw_fhye_1：真实保存待响应时重复点击只发一次，取消和 Escape 不丢稿', async ({
  page,
  localServer,
}) => {
  const { bookId, token } = await loginWithNewBook(page, localServer.request);
  await page.goto(`${localServer.url}/m/balances/auxiliary`);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
  await drawer.getByLabel('默认显示级次').selectOption('-1');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: { procedures: string[]; input: unknown }[] = [];
  await page.route('**/trpc/m.balances.saveSettings*', async (route) => {
    requests.push({
      procedures: decodeURIComponent(new URL(route.request().url()).pathname)
        .slice('/trpc/'.length)
        .split(','),
      input: route.request().postDataJSON(),
    });
    await held;
    await route.continue();
  });
  try {
    await drawer.getByRole('button', { name: '保存设置', exact: true }).dblclick();
    await expect.poll(() => requests.length).toBe(1);
    await expect(drawer.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), `balances.settingsDraft.${bookId}`),
    ).toContain('"level":-1');
  } finally {
    release();
  }
  await expect(drawer).toHaveCount(0);
  const metadata = await callApi<{ settings: Settings }>(
    localServer.request,
    'm.balances.metadata',
    undefined,
    { token, method: 'GET' },
  );
  expect(metadata.settings).toEqual({ revision: 1, display: { level: -1, onlyActivity: false } });
  expect(requests).toHaveLength(1);
  // 一个 HTTP 包仍可批处理多个 mutation，同时核对 procedure 和输入索引。
  expect(requests).toEqual([
    {
      procedures: ['m.balances.saveSettings'],
      input: { '0': { revision: 0, display: { level: -1, onlyActivity: false } } },
    },
  ]);
});
