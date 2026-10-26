import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { callApi, E2E_APP_TOKEN, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_SETTINGS, TRANSFER_LIMIT, type BackupMetadata } from '../shared';
import { largePortableFixture } from '../test/transfer-fixture';
import { probeBodyLimit } from '../test/http-body-limit';

const MIB = 1024 * 1024;
const HTTP_BODY_LIMIT = 50 * MIB; // W0 实际配置；本测试不覆盖或修改服务端配置。
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function seedPackage(request: APIRequestContext, token: string) {
  // 传输测试只测上传/下载副作用；自动调度另由真实生命周期集成测试覆盖。
  await callApi(
    request,
    'm.backup.saveSettings',
    { ...DEFAULT_SETTINGS, enabled: false },
    { token },
  );
  await expect
    .poll(async () => {
      const status = await callApi<{ automaticRunning: boolean }>(
        request,
        'm.backup.overview',
        undefined,
        { token, method: 'GET' },
      );
      return status.automaticRunning;
    })
    .toBe(false);
  const created = await callApi<{ id: string }>(
    request,
    'm.backup.create',
    { requestId: randomUUID(), name: '大包测试种子' },
    { token },
  );
  await expect
    .poll(async () => {
      const rows = await callApi<{ id: string; status: string }[]>(
        request,
        'm.backup.list',
        undefined,
        { token, method: 'GET' },
      );
      return rows.find((r) => r.id === created.id)?.status;
    })
    .toBe('valid');
  const small = await callApi<{ base64: string }>(
    request,
    'm.backup.download',
    { id: created.id },
    { token },
  );
  return Buffer.from(small.base64, 'base64');
}

for (const mebibytes of [4, 8, 32]) {
  test(`w_tzjl_get：${mebibytes} MiB 有效 SQLite 包经真实浏览器上传、HTTP 校验和下载`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const session = await loginWithNewBook(page, request);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-backup-upload-e2e-'));
    try {
      const fixture = await largePortableFixture(
        await seedPackage(request, session.token),
        mebibytes * MIB,
        dir,
      );
      expect(fixture.bytes.length).toBe(mebibytes * MIB);
      await page.goto('/m/backup/');
      const name = `真实大包${mebibytes}MiB`;
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes('m.backup.upload') && r.request().method() === 'POST',
      );
      await page.getByLabel('上传备份包', { exact: true }).setInputFiles({
        name: `${name}.caiwubak`,
        mimeType: 'application/octet-stream',
        buffer: fixture.bytes,
      });
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const bodyBytes = response.request().postDataBuffer()!.length;
      expect(bodyBytes).toBeGreaterThan(fixture.bytes.length);
      expect(bodyBytes).toBeLessThan(HTTP_BODY_LIMIT);
      const batchRow = page
        .getByRole('row')
        .filter({ has: page.getByText(`${name}.caiwubak`, { exact: true }) });
      await expect(batchRow).toContainText('预检通过', { timeout: 30_000 });
      const rows = await callApi<{ id: string; name: string; bytes: number; status: string }[]>(
        request,
        'm.backup.list',
        undefined,
        { token: session.token, method: 'GET' },
      );
      const uploaded = rows.find((r) => r.name === name)!;
      expect(uploaded.status).toBe('valid');
      expect(uploaded.bytes).toBe(fixture.bytes.length);
      const metadata = await callApi<BackupMetadata>(
        request,
        'm.backup.verify',
        { id: uploaded.id },
        { token: session.token },
      );
      expect(metadata.sha256).toBe(fixture.metadata.sha256);
      expect(metadata.length).toBe(fixture.metadata.length);
      const managedRow = page
        .getByRole('row')
        .filter({ has: page.getByText(name, { exact: true }) });
      const downloadedEvent = page.waitForEvent('download');
      await managedRow.getByRole('button', { name: '下载', exact: true }).click();
      const downloaded = await downloadedEvent;
      const file = await downloaded.path();
      expect(file).not.toBeNull();
      const bytes = await readFile(file!);
      expect(bytes.length).toBe(fixture.bytes.length);
      expect(digest(bytes)).toBe(digest(fixture.bytes));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('w_tzjl_get：32 MiB 加一字节由页面和 API 拒绝，真实 50 MiB HTTP body 上限返回 413', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const session = await loginWithNewBook(page, request);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-backup-upload-limit-'));
  try {
    const fixture = await largePortableFixture(
      await seedPackage(request, session.token),
      TRANSFER_LIMIT + 1,
      dir,
    );
    await page.goto('/m/backup/');
    let uploads = 0;
    page.on('request', (r) => {
      if (r.url().includes('m.backup.upload')) uploads++;
    });
    await page.getByLabel('上传备份包', { exact: true }).setInputFiles({
      name: '超过上限.caiwubak',
      mimeType: 'application/octet-stream',
      buffer: fixture.bytes,
    });
    await expect(
      page.getByRole('row').filter({ has: page.getByText('超过上限.caiwubak', { exact: true }) }),
    ).toContainText('文件超过 32 MiB');
    expect(uploads).toBe(0);
    const headers = { 'x-caiwu-token': E2E_APP_TOKEN, authorization: `Bearer ${session.token}` };
    const before = await callApi<unknown[]>(request, 'm.backup.list', undefined, {
      token: session.token,
      method: 'GET',
    });
    const tooLarge = await request.post('/trpc/m.backup.upload', {
      headers,
      data: { name: '超出文件上限', base64: fixture.bytes.toString('base64') },
    });
    expect(tooLarge.status()).toBe(400);
    const error = (await tooLarge.json()) as { error: { data: { business: { code: string } } } };
    expect(error.error.data.business.code).toBe('BACKUP_TRANSFER_SIZE');
    // 原整块 request.post 会与 Fastify 的提前 413 / Connection: close 竞争，
    // EPIPE 不等同于拒绝成功：必须分别读到声明长度及真实分块超限的完整 HTTP 响应。
    const bodyBytes =
      HTTP_BODY_LIMIT + Buffer.byteLength(JSON.stringify({ name: 'HTTP上限', base64: '' }));
    for (const mode of ['declared', 'chunked'] as const) {
      const response = await probeBodyLimit(
        new URL('/trpc/m.backup.upload', page.url()).href,
        headers,
        { mode, bodyBytes },
      );
      expect(response.complete).toBe(true);
      expect(response.status).toBe(413);
      expect(response.headers.connection).toBe('close');
      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 413,
        code: 'FST_ERR_CTP_BODY_TOO_LARGE',
      });
      if (mode === 'declared') expect(response.sentBodyBytes).toBe(0);
      else expect(response.sentBodyBytes).toBeGreaterThan(HTTP_BODY_LIMIT);
    }
    const rows = await callApi<{ name: string; kind: string }[]>(
      request,
      'm.backup.list',
      undefined,
      {
        token: session.token,
        method: 'GET',
      },
    );
    expect(rows).toEqual(before);
    // 上方全量比较仍要求超限请求零副作用；这里核对本夹具唯一的手动种子。
    expect(rows.filter((r) => r.kind === 'manual').map((r) => r.name)).toEqual(['大包测试种子']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
