import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';
import { TRANSFER_LIMIT } from '../shared';
import { padPortablePackage } from './transfer-fixture';

let source: TestApp;
let target: TestApp;
beforeEach(async () => {
  source = await createTestApp({ modules: [backupServer] });
  target = await createTestApp({ modules: [backupServer] });
});
afterEach(async () => {
  await waitForJobs(source.runtime);
  await source.close();
  await waitForJobs(target.runtime);
  await target.close();
});
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it.each([4, 8, 16, 32])(
  'w_bf / w_tzjl_get：%i MiB 真实在线备份经跨目录上传、校验和下载完整往返',
  async (mebibytes) => {
    const bytes = mebibytes * 1024 * 1024;
    // 大内容写入真实临时账套，由生产备份服务生成完整 SQLite 快照。
    await source.svcFor('backup').settings.set('transferFixture', 'x'.repeat(bytes - 512 * 1024));
    const api = source.call(backupServer);
    const created = await api.create({ requestId: randomUUID(), name: '大文件真实备份' });
    await waitForJobs(source.runtime);
    const item = (await api.list()).find((r) => r.id === created.id)!;
    expect(item.status, item.reason).toBe('valid');
    expect(item.bytes).toBeGreaterThan(bytes - 512 * 1024);
    expect(item.bytes).toBeLessThan(bytes);
    const pack = padPortablePackage(
      Buffer.from((await api.download({ id: item.id })).base64, 'base64'),
      bytes,
    );
    expect(pack.length).toBe(bytes);
    const receiver = target.call(backupServer);
    const uploaded = await receiver.upload({
      name: `真实包${mebibytes}MiB`,
      base64: pack.toString('base64'),
    });
    expect(uploaded.status).toBe('valid');
    expect(uploaded.bytes).toBe(bytes);
    const metadata = await receiver.verify({ id: uploaded.id });
    expect(metadata.book.id).toBe(source.book.id);
    expect(metadata.sha256).toBe(item.metadata!.sha256);
    const exported = Buffer.from((await receiver.download({ id: uploaded.id })).base64, 'base64');
    expect(exported.length).toBe(bytes);
    expect(sha256(exported)).toBe(sha256(pack));
  },
  60_000,
);

it.each([
  '',
  'A',
  'AAA',
  'A===',
  'AAAA=',
  'AA=A',
  '====',
  'AA-_',
  'AA\nA',
  'AA A',
  'AA中A',
  'AB==',
  'AAB=',
])('w_tzjl_get：非法 base64 %j 在写文件前明确拒绝', async (base64) => {
  await expect(target.call(backupServer).upload({ name: '非法编码', base64 })).rejects.toThrow(
    'base64',
  );
  expect(await target.call(backupServer).list()).toEqual([]);
});
it('w_tzjl_get：32 MiB 加一字节即使编码长度未超 schema 也按实际解码长度拒绝', async () => {
  const base64 = Buffer.alloc(TRANSFER_LIMIT + 1).toString('base64');
  expect(base64.length).toBe(Math.ceil(TRANSFER_LIMIT / 3) * 4);
  await expect(target.call(backupServer).upload({ name: '越界包', base64 })).rejects.toThrow(
    '32 MiB',
  );
  expect(await target.call(backupServer).list()).toEqual([]);
});
