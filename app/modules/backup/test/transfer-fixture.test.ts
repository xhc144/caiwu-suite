import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backupServer from './isolated-server';
import { validatePackage } from '../server/files';
import { waitForJobs } from '../server/service';
import { TRANSFER_LIMIT } from '../shared';
import { largePortableFixture } from './transfer-fixture';

let app: TestApp;
let dir: string;
const seedContent = '完整 schema 之外仍须保留的合成数据'.repeat(24 * 1024);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  dir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-backup-exact-fixture-'));
});
afterEach(async () => {
  await waitForJobs(app.runtime);
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

it.each([4 * 1024 * 1024, 8 * 1024 * 1024, TRANSFER_LIMIT, TRANSFER_LIMIT + 1])(
  'w_tzjl_get：超过 512 KiB 的真实 seed 构造 %i 字节包，保留内容并通过完整校验',
  async (targetBytes) => {
    await app.svcFor('backup').settings.set('schemaSeedPadding', seedContent);
    const api = app.call(backupServer);
    const row = await api.create({ requestId: randomUUID(), name: '动态大小种子' });
    await waitForJobs(app.runtime);
    const seed = Buffer.from((await api.download({ id: row.id })).base64, 'base64');
    const seedOffset = 12 + seed.readUInt32BE(8);
    expect(seed.length - seedOffset).toBeGreaterThan(700 * 1024);
    const fixture = await largePortableFixture(seed, targetBytes, dir);
    expect(fixture.bytes.length).toBe(targetBytes);
    const offset = 12 + fixture.bytes.readUInt32BE(8);
    const sqlite = fixture.bytes.subarray(offset);
    expect(sqlite.length).toBe(fixture.metadata.length);
    expect(digest(sqlite)).toBe(fixture.metadata.sha256);
    const file = path.join(dir, 'exact.caiwubak');
    await writeFile(file, fixture.bytes, { flag: 'wx' });
    // 本地校验没有浏览器 32 MiB 上限，因此 +1 的包也须在内容和格式上真实有效。
    const checked = await validatePackage(file, app.runtime);
    expect(checked.bytes).toBe(targetBytes);
    expect(checked.metadata).toEqual(fixture.metadata);
    expect(checked.digest).toBe(digest(fixture.bytes));
    expect((await readFile(checked.snapshot)).equals(sqlite)).toBe(true);
    const raw = new Database(checked.snapshot, { readonly: true });
    try {
      const setting = raw
        .prepare('SELECT value FROM book_setting WHERE scope=? AND key=?')
        .get('backup', 'schemaSeedPadding') as { value: string };
      expect(JSON.parse(setting.value)).toBe(seedContent);
    } finally {
      raw.close();
    }
  },
  60_000,
);
