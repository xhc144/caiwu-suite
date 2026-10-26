import { randomUUID } from 'node:crypto';
import type * as Fs from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backupServer from './isolated-server';
import { directory, hashFile, packagePath } from '../server/files';
import { waitForJobs } from '../server/service';

const injected = vi.hoisted(() => ({
  target: '',
  withoutNoFollow: false,
  beforeOpen: undefined as (() => Promise<void>) | undefined,
  afterEntryCheck: undefined as (() => Promise<void>) | undefined,
  zeroIdentity: false,
  opens: 0,
  reads: [] as ReturnType<typeof vi.fn>[],
  closes: [] as ReturnType<typeof vi.fn>[],
  flags: [] as (string | number | undefined)[],
  lstats: 0,
  replacements: 0,
}));
// 只模拟缺少 O_NOFOLLOW 的文件标志语义；其余操作是真实 POSIX 文件系统。
// 这些测试不是 Windows 实跑证据。
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const constants = { ...actual.constants };
  Object.defineProperty(constants, 'O_NOFOLLOW', {
    get: () => (injected.withoutNoFollow ? undefined : actual.constants.O_NOFOLLOW),
  });
  return { ...actual, constants };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      if (args[0] === injected.target) {
        injected.lstats++;
        if (injected.zeroIdentity) return Object.assign(info, { ino: 0n });
        if (injected.lstats === 2 && injected.afterEntryCheck) {
          injected.replacements++;
          await injected.afterEntryCheck();
        }
      }
      return info;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      if (args[0] !== injected.target) return actual.open(...args);
      injected.opens++;
      injected.flags.push(args[1]);
      if (injected.beforeOpen) {
        injected.replacements++;
        await injected.beforeOpen();
      }
      const h = await actual.open(...args);
      injected.reads.push(vi.spyOn(h, 'read'));
      injected.closes.push(vi.spyOn(h, 'close'));
      return h;
    },
  };
});

let app: TestApp;
const caller = (a: TestApp) => a.call(backupServer);
let api: ReturnType<typeof caller>;
let id: string;
let file: string;
let bytes: Buffer;
beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  api = caller(app);
  const row = await api.create({ requestId: randomUUID(), name: '受管读取测试' });
  await waitForJobs(app.runtime);
  expect((await api.list()).find((r) => r.id === row.id)?.status).toBe('valid');
  id = row.id;
  file = packagePath(await directory(app.runtime.dataDir, app.book.id, '手动与保护'), id);
  bytes = await readFile(file);
  injected.target = file;
});
afterEach(async () => {
  injected.target = '';
  injected.withoutNoFollow = false;
  injected.beforeOpen = undefined;
  injected.afterEntryCheck = undefined;
  injected.zeroIdentity = false;
  injected.opens = 0;
  injected.reads = [];
  injected.closes = [];
  injected.flags = [];
  injected.lstats = 0;
  injected.replacements = 0;
  vi.restoreAllMocks();
  // 只清理本测试创建的链接/文件，不改变共享层目录保护。
  await rm(file, { recursive: true, force: true });
  await waitForJobs(app.runtime);
  await app.close();
});
const noSnapshot = async () => {
  expect((await readdir(path.dirname(file))).filter((n) => n.endsWith('.checking'))).toEqual([]);
};
const closedOnce = () => {
  expect(injected.opens).toBe(1);
  expect(injected.closes).toHaveLength(1);
  expect(injected.closes[0]).toHaveBeenCalledTimes(1);
};

describe.each([false, true])('受管读取：模拟缺少 O_NOFOLLOW = %s', (withoutNoFollow) => {
  beforeEach(() => {
    injected.withoutNoFollow = withoutNoFollow;
  });
  it('w_hf：下载在读取合成账套链接的 SQLite 头之前以 FILE 拒绝', async () => {
    const target = app.runtime.bookStore.pathOf(app.book.id);
    const before = await readFile(target);
    await rm(file);
    await symlink(target, file);
    await expect(api.download({ id })).rejects.toMatchObject({
      cause: { data: { code: 'BACKUP_FILE' }, message: expect.stringContaining('符号链接') },
    });
    expect(injected.opens).toBe(0);
    expect(injected.reads).toHaveLength(0);
    expect(await readFile(target)).toEqual(before);
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    await noSnapshot();
  });
  it('w_hf：完整校验和下载只打开受管包一次，返回该句柄校验过的全部字节', async () => {
    const result = await api.download({ id });
    expect(Buffer.from(result.base64, 'base64')).toEqual(bytes);
    closedOnce();
    expect(injected.reads[0]).toHaveBeenCalled();
    await noSnapshot();
  });
  it('w_hf：校验期间路径被替换时拒绝返回，读取仍只有原句柄并清理快照', async () => {
    injected.afterEntryCheck = async () => {
      await rename(file, `${file}.original`);
      await writeFile(file, '受控替换后的未知文件');
    };
    await expect(api.download({ id })).rejects.toMatchObject({
      cause: { data: { code: 'BACKUP_CHANGED' } },
    });
    expect(injected.replacements).toBe(1);
    closedOnce();
    expect(injected.reads[0]).toHaveBeenCalled();
    expect(await readFile(file, 'utf8')).toBe('受控替换后的未知文件');
    await noSnapshot();
  });
});

it.each(['symlink', 'regular'] as const)(
  'w_hf：缺少 nofollow，lstat 后在 open 前换成 %s 仍在首次读取前拒绝',
  async (kind) => {
    injected.withoutNoFollow = true;
    const replacement = path.join(path.dirname(file), 'replacement.caiwubak');
    // 内容相同但文件身份不同，不能只靠格式/摘要得到绿灯。
    await copyFile(file, replacement);
    injected.beforeOpen = async () => {
      await rename(file, `${file}.original`);
      if (kind === 'symlink') await symlink(replacement, file);
      else await copyFile(replacement, file);
    };
    await expect(api.download({ id })).rejects.toMatchObject({
      cause: { data: { code: 'BACKUP_CHANGED' } },
    });
    expect(injected.replacements).toBe(1);
    closedOnce();
    expect(injected.flags).toEqual([0]);
    expect(injected.reads[0]).not.toHaveBeenCalled();
    expect(await readFile(replacement)).toEqual(bytes);
    await noSnapshot();
  },
);
it.each(['directory', 'hardlink', 'zero-identity', 'dangling-symlink'])(
  'w_hf：摘要入口在 open 前拒绝 %s',
  async (kind) => {
    if (kind === 'zero-identity') injected.zeroIdentity = true;
    else if (kind === 'hardlink') await link(file, `${file}.extra-link`);
    else {
      await rm(file);
      if (kind === 'directory') await mkdir(file);
      else await symlink(`${file}.missing`, file);
    }
    await expect(hashFile(file)).rejects.toMatchObject({ data: { code: 'BACKUP_FILE' } });
    expect(injected.opens).toBe(0);
  },
);
