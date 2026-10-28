import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, createBook, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_SETTINGS } from '../shared';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function portable(request: APIRequestContext, name: string, intervalMinutes = 31) {
  const book = await createBook(request, { name: `${name}-${randomUUID().slice(0, 8)}` });
  const login = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: book.bookId,
    userCode: 'admin',
    password: 'admin',
  });
  const options = { token: login.token };
  await callApi(
    request,
    'm.backup.saveSettings',
    { ...DEFAULT_SETTINGS, intervalMinutes },
    options,
  );
  const item = await callApi<{ id: string }>(
    request,
    'm.backup.create',
    { requestId: randomUUID(), name: '批量合成来源' },
    options,
  );
  await expect
    .poll(
      async () =>
        (
          await callApi<{ id: string; status: string }[]>(request, 'm.backup.list', undefined, {
            ...options,
            method: 'GET',
          })
        ).find((r) => r.id === item.id)?.status,
    )
    .toBe('valid');
  const data = await callApi<{ base64: string }>(
    request,
    'm.backup.download',
    { id: item.id },
    options,
  );
  return { name: book.bookName, buffer: Buffer.from(data.base64, 'base64') };
}
async function holdFirstUpload(page: Page) {
  const started = deferred();
  const released = deferred();
  let uploads = 0;
  let previews = 0;
  page.on('request', (request) => {
    if (request.url().includes('m.backup.preview')) previews++;
  });
  await page.route(/\/trpc\/m\.backup\.upload/, async (route) => {
    uploads++;
    const response = await route.fetch();
    if (uploads === 1) {
      started.resolve();
      await released.promise;
    }
    await route.fulfill({ response });
  });
  return {
    started: started.promise,
    release: released.resolve,
    uploads: () => uploads,
    previews: () => previews,
  };
}
const row = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });

test('w_tzjl_get_all：关闭标签后两包继续真实上传预检，重开保留确认项并可恢复首包数据', async ({
  page,
  request,
}) => {
  const first = await portable(request, '批量来源一', 31);
  const second = await portable(request, '批量来源二', 43);
  await loginWithNewBook(page, request);
  await page.goto('/m/backup/');
  const gate = await holdFirstUpload(page);
  try {
    await page.getByLabel('上传备份包', { exact: true }).setInputFiles([
      { name: '跨页一.caiwubak', mimeType: 'application/octet-stream', buffer: first.buffer },
      { name: '跨页二.caiwubak', mimeType: 'application/octet-stream', buffer: second.buffer },
    ]);
    await gate.started;
    await page.getByRole('button', { name: '关闭所有', exact: true }).click();
    await expect(page.getByRole('tab', { name: '备份恢复', exact: true })).toHaveCount(0);
    gate.release();
    await expect.poll(gate.previews).toBe(2);
    expect(gate.uploads()).toBe(2);
    await page.getByRole('menuitem', { name: '备份恢复', exact: true }).click();
    await expect(row(page, '跨页一.caiwubak')).toContainText('预检通过');
    await expect(row(page, '跨页二.caiwubak')).toContainText('预检通过');
    await page
      .getByLabel('恢复确认文字', { exact: true })
      .fill(`恢复副本 ${second.name}（恢复副本）`);
    await page.getByLabel('管理员密码', { exact: true }).fill('admin');
    await row(page, '跨页一.caiwubak')
      .getByRole('button', { name: '确认此项', exact: true })
      .click();
    await expect(page.getByLabel('恢复确认文字', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('管理员密码', { exact: true })).toHaveValue('');
    const copyName = `${first.name}（恢复副本）`;
    await page.getByLabel('恢复确认文字', { exact: true }).fill(`恢复副本 ${copyName}`);
    await page.getByLabel('管理员密码', { exact: true }).fill('admin');
    await page.getByRole('button', { name: '确认恢复为新账套', exact: true }).click();
    await expect(page.getByRole('heading', { name: '已恢复为新账套', exact: true })).toBeVisible();
    const books = await callApi<{ id: string; name: string }[]>(request, 'core.books.list');
    const restored = books.find((book) => book.name === copyName)!;
    const login = await callApi<{ token: string }>(request, 'core.auth.login', {
      bookId: restored.id,
      userCode: 'admin',
      password: 'admin',
    });
    const data = await callApi<{ config: { intervalMinutes: number } }>(
      request,
      'm.backup.overview',
      undefined,
      { token: login.token, method: 'GET' },
    );
    expect(data.config.intervalMinutes).toBe(31);
  } finally {
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('w_tzjl_get_all：重开活动队列后可取消未开始项，已发首包保留且后续包没有上传', async ({
  page,
  request,
}) => {
  const pack = await portable(request, '跨页取消来源');
  await loginWithNewBook(page, request);
  await page.goto('/m/backup/');
  await page.getByLabel('副本名称', { exact: true }).fill('跨页自定副本');
  const gate = await holdFirstUpload(page);
  try {
    await page.getByLabel('上传备份包', { exact: true }).setInputFiles(
      ['首包', '未开始二', '未开始三'].map((name) => ({
        name: `${name}.caiwubak`,
        mimeType: 'application/octet-stream',
        buffer: pack.buffer,
      })),
    );
    await gate.started;
    await page.getByRole('button', { name: '关闭所有', exact: true }).click();
    await page.getByRole('menuitem', { name: '备份恢复', exact: true }).click();
    await expect(page.getByLabel('副本名称', { exact: true })).toHaveValue('跨页自定副本');
    await expect(row(page, '首包.caiwubak')).toContainText('上传并校验中');
    await page.getByRole('button', { name: '取消未开始的上传', exact: true }).click();
    gate.release();
    await expect(row(page, '首包.caiwubak')).toContainText('预检通过');
    await expect(row(page, '未开始二.caiwubak')).toContainText('已取消未开始项');
    await expect(row(page, '未开始三.caiwubak')).toContainText('已取消未开始项');
    expect(gate.uploads()).toBe(1);
    expect(gate.previews()).toBe(1);
    await row(page, '首包.caiwubak').getByRole('button', { name: '取消此项', exact: true }).click();
    await expect(row(page, '首包.caiwubak')).toContainText('已取消');
    await expect(
      row(page, '首包.caiwubak').getByRole('button', { name: '确认此项', exact: true }),
    ).toHaveCount(0);
  } finally {
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('w_tzjl_get_all：旧上传响应在切账登录后到达，不恢复旧队列、不创建预览、不发送下一包', async ({
  page,
  request,
}) => {
  const pack = await portable(request, '重新登录来源');
  const nextBook = await createBook(request, { name: `队列隔离目标-${randomUUID().slice(0, 8)}` });
  await loginWithNewBook(page, request);
  await page.goto('/m/backup/');
  const gate = await holdFirstUpload(page);
  try {
    await page.getByLabel('上传备份包', { exact: true }).setInputFiles(
      ['旧队列一', '旧队列二'].map((name) => ({
        name: `${name}.caiwubak`,
        mimeType: 'application/octet-stream',
        buffer: pack.buffer,
      })),
    );
    await gate.started;
    await page.getByRole('button', { name: /系统管理员$/ }).click();
    await page
      .locator('.ant-dropdown')
      .getByRole('menuitem', { name: '切换账套', exact: true })
      .click();
    await expect(page.getByText('选择账套', { exact: true })).toBeVisible();
    await page.getByLabel('搜索账套', { exact: true }).fill(nextBook.bookName);
    await row(page, nextBook.bookName).getByRole('button', { name: '进入', exact: true }).click();
    await expect(page).toHaveURL(/\/login\//);
    await page.getByLabel('密码', { exact: true }).fill('admin');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('menuitem', { name: '备份恢复', exact: true }).click();
    await expect(page.getByLabel('上传备份包', { exact: true })).toBeEnabled();
    await expect(page.getByText('旧队列一.caiwubak', { exact: true })).toHaveCount(0);
    await expect(page.getByText('旧队列二.caiwubak', { exact: true })).toHaveCount(0);
    expect(gate.uploads()).toBe(1);
    expect(gate.previews()).toBe(0);
  } finally {
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
