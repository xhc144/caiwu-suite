import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, request as playwrightRequest, test as base } from '@playwright/test';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { callApi } from '@caiwu/testkit/e2e';
import cashier from '../../../modules/cashier/server';
import backup from '../../../modules/backup/server';
import type { CashierFixture } from '../../../modules/cashier/e2e/fixture';
import { bankBook, documents, recordThree } from '../../../modules/cashier/e2e/scenarios';
import { createServer } from '../src/server';

const test = base.extend<{ host: CashierFixture & { dataDir: string } }>({
  host: async ({ browser }, use) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'cashier-protection-host-'));
    const server = await createServer({
      dataDir,
      token: 'e2e-token',
      modules: [cashier, backup],
      devMode: true,
      webDist: path.resolve('apps/web/dist'),
    });
    const baseURL = await server.fastify.listen({ host: '127.0.0.1', port: 0 });
    const context = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const request = await playwrightRequest.newContext({ baseURL });
    try {
      await use({
        page: await context.newPage(),
        request,
        baseURL,
        dataDir,
        withServices: (bookId, action) =>
          server.runtime.bookStore.withBook(bookId, async (book) =>
            action(
              createCoreServices({
                db: book.db,
                user: (await loadServiceUser(book.db, 1))!,
                moduleId: null,
                now: server.runtime.now,
                modules: server.runtime.modules.lookup,
                providers: server.runtime.modules.providers,
              }),
            ),
          ),
      });
    } finally {
      await request.dispose();
      await context.close();
      await server.fastify.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});

async function openReset(host: CashierFixture, bookName: string) {
  await host.page.goto('/m/cashier/accounts');
  await host.page.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  const drawer = host.page.getByRole('dialog', { name: '重新初始化出纳', exact: true });
  await expect(drawer.getByText('3 张', { exact: true })).toBeVisible();
  await drawer.getByLabel('确认初始化账套名称').fill(bookName);
  return drawer;
}

test('w_cn_xtcsh：宿主真实保护包、强确认取消、清空成功及重新录入账户期初', async ({ host }) => {
  const book = await bankBook(host);
  await recordThree(host, book);
  const drawer = await openReset(host, book.bookName);
  await drawer.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  let confirmation = host.page.getByRole('dialog', { name: '确认备份后清空全部出纳数据' });
  await expect(confirmation.getByRole('button', { name: '创建保护备份并清空' })).toBeDisabled();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect(await documents(host, book)).toHaveLength(3);
  await drawer.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
  confirmation = host.page.getByRole('dialog', { name: '确认备份后清空全部出纳数据' });
  await confirmation.getByLabel('确认文字').fill('清空出纳数据');
  await confirmation.getByRole('button', { name: '创建保护备份并清空' }).click();
  await expect(drawer.getByText('出纳已重新初始化，请重新建立账户并录入期初')).toBeVisible();
  const backups = await callApi<{ id: string; kind: string; digest: string }[]>(
    host.request,
    'm.backup.list',
    {},
    { token: book.token },
  );
  const protection = backups.find((row) => row.kind === 'pre-restore')!;
  const file = await callApi<{ base64: string }>(
    host.request,
    'm.backup.download',
    { id: protection.id },
    { token: book.token },
  );
  const bytes = Buffer.from(file.base64, 'base64');
  expect(bytes.subarray(0, 8).toString()).toBe('CAIWUBK1');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(protection.digest);
  const headerLength = bytes.readUInt32BE(8);
  const metadata = JSON.parse(bytes.subarray(12, 12 + headerLength).toString()) as {
    book: { id: string };
    sha256: string;
  };
  const content = bytes.subarray(12 + headerLength);
  expect(metadata.book.id).toBe(book.bookId);
  expect(createHash('sha256').update(content).digest('hex')).toBe(metadata.sha256);
  const extracted = path.join(host.dataDir, 'synthetic-readback.caiwu');
  await writeFile(extracted, content, { flag: 'wx' });
  const raw = new Database(extracted, { readonly: true, fileMustExist: true });
  try {
    expect(raw.prepare('SELECT count(*) AS n FROM cashier_document').get()).toEqual({ n: 3 });
    expect(raw.prepare('SELECT count(*) AS n FROM cashier_account').get()).toEqual({ n: 1 });
    expect(raw.prepare('SELECT balance FROM cashier_opening').get()).toEqual({ balance: 100000 });
    expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(raw.pragma('foreign_key_check')).toEqual([]);
  } finally {
    raw.close();
  }
  expect(await documents(host, book)).toEqual([]);
  await host.withServices(book.bookId, async (svc) => {
    expect(await svc.opening.list(2026)).toContainEqual(
      expect.objectContaining({ balance: 100000 }),
    );
  });
  await drawer.getByRole('button', { name: '返回账户与期初' }).click();
  await expect(host.page.getByRole('row', { name: /闭环银行/ })).not.toBeVisible();
  await host.page.getByRole('button', { name: '新增账户', exact: true }).click();
  await expect(host.page.getByRole('dialog', { name: '新增出纳账户' })).toBeVisible();
});

test('w_cn_xtcsh：保护目录写入失败页面保留输入与所有单据，修复后真实重试成功', async ({ host }) => {
  const book = await bankBook(host);
  await recordThree(host, book);
  const before = await documents(host, book);
  const root = path.join(host.dataDir, 'backups');
  const saved = path.join(host.dataDir, 'synthetic-protected-directory');
  // 未发生自动备份的全新账套；真实受管目录拒绝符号链接，不接触环境外的文件。
  await mkdir(saved);
  await symlink(saved, root, 'dir');
  try {
    const drawer = await openReset(host, book.bookName);
    const confirm = async () => {
      await drawer.getByRole('button', { name: '重新初始化出纳', exact: true }).click();
      const dialog = host.page.getByRole('dialog', { name: '确认备份后清空全部出纳数据' });
      await dialog.getByLabel('确认文字').fill('清空出纳数据');
      await dialog.getByRole('button', { name: '创建保护备份并清空' }).click();
    };
    await confirm();
    await expect(
      host.page.getByText('完整保护备份失败，出纳数据尚未清空', { exact: true }).first(),
    ).toBeVisible();
    await expect(drawer.getByLabel('确认初始化账套名称')).toHaveValue(book.bookName);
    expect(await documents(host, book)).toEqual(before);
    await unlink(root);
    await confirm();
    await expect(drawer.getByText('出纳已重新初始化，请重新建立账户并录入期初')).toBeVisible();
    expect(await documents(host, book)).toEqual([]);
  } finally {
    const entry = await lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (entry?.isSymbolicLink()) await unlink(root);
  }
});
