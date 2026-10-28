import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import booksServer from '../server';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [booksServer], seed: false });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
const input = () => ({
  targetId: app.book.id,
  userCode: 'admin',
  password: 'admin',
  requestId: randomUUID(),
  name: '合成维护回归副本',
  confirmed: true as const,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const files = () =>
  readdirSync(app.runtime.bookStore.booksDir)
    .filter((file) => file.endsWith('.caiwu'))
    .sort();

describe('w_tzjl_2 / w_tzjl_kl 复制收据的维护访问保护', () => {
  it('正常复制保留业务数据、重试复用原副本，同请求改名仍拒绝', async () => {
    const api = app.call(booksServer);
    const request = input();
    await app.svcFor('books').settings.set('synthetic-copy-value', { amount: 12_345 });
    const source = await app.svc.book.info();
    const copied = await api.copy(request);
    expect(copied.id).not.toBe(source.id);
    expect(copied).toMatchObject({ name: request.name, startPeriod: source.startPeriod });
    const value = await app.runtime.bookStore.withBook(copied.id, async (book) =>
      book.db
        .selectFrom('book_setting')
        .select('value')
        .where('scope', '=', 'books')
        .where('key', '=', 'synthetic-copy-value')
        .executeTakeFirst(),
    );
    expect(JSON.parse(value!.value)).toEqual({ amount: 12_345 });
    const firstFiles = files();
    expect((await api.copy(request)).id).toBe(copied.id);
    expect(files()).toEqual(firstFiles);
    await expect(api.copy({ ...request, name: '同请求不同名称' })).rejects.toThrow('其它名称');
    expect(files()).toEqual(firstFiles);
    expect(await app.svc.book.info()).toEqual(source);
  });

  it('副本在枚举前维护时严格收据发现拒绝重试，不因界面列表漏项新建第二副本', async () => {
    const api = app.call(booksServer);
    const request = input();
    const copied = await api.copy(request);
    const before = files();
    const store = app.runtime.bookStore;
    const entered = deferred(),
      release = deferred();
    const maintenance = store.maintain(copied.id, {
      kind: 'reconnect',
      prepare: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;
    try {
      expect((await store.list()).some((book) => book.id === copied.id)).toBe(false);
      await expect(api.copy(request)).rejects.toThrow('账套正在维护');
      expect(files()).toEqual(before);
    } finally {
      release.resolve();
      await maintenance;
    }
    expect((await api.copy(request)).id).toBe(copied.id);
    expect(files()).toEqual(before);
  });

  it('列表列出后副本开始维护，收据扫描拒绝访问且无额外副本；维护结束后仍可重试', async () => {
    const api = app.call(booksServer);
    const request = input();
    const copied = await api.copy(request);
    const before = files();
    const store = app.runtime.bookStore;
    const entered = deferred(),
      release = deferred();
    let maintenance: Promise<unknown> | undefined;
    const originalList = store.listStrict.bind(store);
    const list = vi.spyOn(store, 'listStrict').mockImplementationOnce(async () => {
      const listed = await originalList();
      expect(listed.some((book) => book.id === copied.id)).toBe(true);
      maintenance = store.maintain(copied.id, {
        kind: 'reconnect',
        prepare: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      await entered.promise;
      return listed;
    });
    try {
      await expect(api.copy(request)).rejects.toThrow('账套正在维护');
      expect(files()).toEqual(before);
    } finally {
      release.resolve();
      await maintenance;
      list.mockRestore();
    }
    expect((await api.copy(request)).id).toBe(copied.id);
    expect(files()).toEqual(before);
  });
});
