import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '@caiwu/db';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { BookStore } from '../src/server';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let t: TestBook | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const options = () => ({ dataDir: t!.dataDir, templates: t!.templates, migrationSets: () => [] });

describe('账套维护的真实连接生命周期', () => {
  for (const location of ['cached', 'extra'] as const) {
    it.each(['close', 'maintain', 'closeAll'] as const)(
      `${location} 连接留有原生事务时 %s 拒绝且保留全部句柄，提交后可重试`,
      async (operation) => {
        t = await createTestBook({ seed: false });
        const { store, info, book } = t;
        const extra = openDatabase<{ book_info: { name: string } }>(book.file);
        await extra.db.selectFrom('book_info').selectAll().execute();
        const pending = location === 'cached' ? book : extra;
        let prepared = 0;
        const act = () =>
          operation === 'close'
            ? store.close(info.id)
            : operation === 'closeAll'
              ? store.closeAll()
              : store.maintain(info.id, {
                  kind: 'reconnect',
                  prepare: async () => {
                    prepared++;
                  },
                });
        try {
          pending.raw.exec("BEGIN; UPDATE book_info SET name = '原生事务提交'");
          await expect(act()).rejects.toThrow(/未登记的原生事务/);
          expect(prepared).toBe(0);
          expect(book.raw.open).toBe(true);
          expect(extra.raw.open).toBe(true);
          expect(pending.raw.inTransaction).toBe(true);
          pending.raw.exec('COMMIT');
          await act();
          expect(store.open(info.id).raw.prepare('SELECT name FROM book_info').get()).toEqual({
            name: '原生事务提交',
          });
        } finally {
          if (pending.raw.open && pending.raw.inTransaction) pending.raw.exec('ROLLBACK');
          if (extra.raw.open) await extra.close();
        }
      },
    );
  }

  it('事务回调内关闭/维护快速拒绝，事务回滚后仍能正常使用', async () => {
    t = await createTestBook({ seed: false });
    await expect(
      t.svc.tx(async () => t!.store.maintain(t!.info.id, { kind: 'reconnect' })),
    ).rejects.toThrow(/事务回调内/);
    await expect(t.svc.tx(async () => t!.store.close(t!.info.id))).rejects.toThrow(/事务回调内/);
    expect(t.store.open(t.info.id).raw.open).toBe(true);
  });

  it('显式后台任务可取得新租约；请求结束后旧 svc/连接调用链不能直接复用', async () => {
    t = await createTestBook({ seed: false });
    const { store, info } = t;
    const later = deferred();
    let background!: Promise<void>;
    await store.withBook(info.id, async (book) => {
      background = (async () => {
        await later.promise;
        await expect(book.db.selectFrom('book_info').selectAll().execute()).rejects.toThrow(
          /租约已结束/,
        );
        await store.withBook(info.id, async (fresh) => {
          await fresh.db.updateTable('book_info').set({ name: '后台租约' }).execute();
        });
      })();
    });
    later.resolve();
    await background;
    expect(store.open(info.id).raw.prepare('SELECT name FROM book_info').get()).toEqual({
      name: '后台租约',
    });
  });

  it('close-await 超时仍持有门，实际关闭结束后恢复原账套连接', async () => {
    t = await createTestBook({ seed: false });
    const { store, info } = t;
    const extra = openDatabase(t.book.file);
    const finish = deferred();
    const close = extra.close;
    extra.close = async () => {
      await finish.promise;
      await close();
    };
    await expect(
      store.maintain(info.id, { kind: 'reconnect', timeoutMs: 20 }),
    ).rejects.toMatchObject({ data: { code: 'MAINTENANCE_TIMEOUT' } });
    expect(() => store.open(info.id)).toThrow(/正在维护/);
    finish.resolve();
    await setImmediate();
    expect(extra.raw.open).toBe(false);
    expect(store.open(info.id).raw.open).toBe(true);
  });

  it('排空两个写事务，期间拒绝新租约和 open；重开保留两次提交', async () => {
    t = await createTestBook({ seed: false });
    const { store, info } = t;
    const entered = deferred(),
      release = deferred();
    const first = store.withBook(info.id, (b) =>
      withTransaction(b.db, async (trx) => {
        await trx.updateTable('book_info').set({ name: '第一次提交' }).execute();
        entered.resolve();
        await release.promise;
      }),
    );
    await entered.promise;
    const second = store.withBook(info.id, (b) =>
      withTransaction(b.db, async (trx) => {
        await trx.updateTable('book_info').set({ org_name: '第二次提交' }).execute();
      }),
    );
    let prepared = false;
    const maintenance = store.maintain(info.id, {
      kind: 'reconnect',
      prepare: async () => {
        prepared = true;
      },
    });
    expect(prepared).toBe(false);
    expect(() => store.open(info.id)).toThrow(/正在维护/);
    await expect(store.withBook(info.id, async () => {})).rejects.toThrow(/正在维护/);
    release.resolve();
    await Promise.all([first, second, maintenance]);
    expect(store.open(info.id).raw.prepare('SELECT name, org_name FROM book_info').get()).toEqual({
      name: '第一次提交',
      org_name: '第二次提交',
    });
    expect(prepared).toBe(true);
  });

  it('关闭全部登记连接，真实 destroy await 期间禁止重开，旧句柄不可再访问', async () => {
    t = await createTestBook({ seed: false });
    const { store, info } = t;
    const extra = openDatabase(t.book.file);
    const started = deferred(),
      release = deferred();
    const original = extra.close;
    extra.close = async () => {
      started.resolve();
      await release.promise;
      await original();
    };
    const closing = store.close(info.id);
    await started.promise;
    expect(() => store.open(info.id)).toThrow(/正在维护/);
    expect(() => openDatabase(t!.book.file)).toThrow(/正在维护/);
    release.resolve();
    await closing;
    expect(t.book.raw.open).toBe(false);
    expect(extra.raw.open).toBe(false);
    expect(store.open(info.id).raw.open).toBe(true);
    await expect(t.book.db.selectFrom('book_info').selectAll().execute()).rejects.toThrow();
  });

  it('直接 db.destroy 也阻止同文件 open，等待真实事务完成才关闭', async () => {
    t = await createTestBook({ seed: false });
    const file = path.join(t.dataDir, 'extra.sqlite');
    const extra = openDatabase<{ t: { id: number } }>(file);
    extra.raw.exec('CREATE TABLE t (id INTEGER)');
    const entered = deferred(),
      release = deferred();
    const writing = withTransaction(extra.db, async (trx) => {
      await trx.insertInto('t').values({ id: 1 }).execute();
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const closing = extra.db.destroy();
    expect(() => openDatabase(file)).toThrow();
    release.resolve();
    await writing;
    await closing;
    const reopened = openDatabase(file);
    expect(reopened.raw.prepare('SELECT * FROM t').all()).toEqual([{ id: 1 }]);
    await reopened.close();
  });

  it('未知外部 WAL 连接活动时拒绝 delete/replace，晚提交保留在原文件', async () => {
    t = await createTestBook({ seed: false });
    const external = new Database(t.book.file);
    try {
      external.pragma('journal_mode = WAL');
      external.exec("BEGIN; UPDATE book_info SET name = '外部晚提交'");
      let called = false;
      for (const kind of ['delete', 'replace'] as const) {
        await expect(
          t.store.maintain(t.info.id, {
            kind,
            prepare: async () => {
              called = true;
            },
          }),
        ).rejects.toMatchObject({ data: { code: 'DESTRUCTIVE_MAINTENANCE_UNAVAILABLE' } });
      }
      expect(called).toBe(false);
      expect(existsSync(t.book.file + '-wal')).toBe(true);
      external.exec('COMMIT');
      expect(t.book.raw.prepare('SELECT name FROM book_info').get()).toEqual({
        name: '外部晚提交',
      });
      expect(existsSync(t.book.file)).toBe(true);
    } finally {
      external.close();
    }
  });

  it('prepare 事务失败回滚并释放门；validate 失败后原文件仍能重开', async () => {
    t = await createTestBook({ seed: false });
    const { store, info } = t;
    await expect(
      store.maintain(info.id, {
        kind: 'reconnect',
        prepare: (b) =>
          withTransaction(b.db, async (trx) => {
            await trx.updateTable('book_info').set({ name: '不应保存' }).execute();
            throw new Error('备份失败');
          }),
      }),
    ).rejects.toThrow('备份失败');
    expect(store.open(info.id).raw.prepare('SELECT name FROM book_info').get()).toEqual({
      name: '测试账套',
    });
    await expect(
      store.maintain(info.id, {
        kind: 'reconnect',
        validate: async () => {
          throw new Error('校验失败');
        },
      }),
    ).rejects.toThrow('校验失败');
    expect(store.open(info.id).raw.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
  });

  it('排空超时不执行 callback；未结束 callback 超时后仍持有门，结束后恢复', async () => {
    t = await createTestBook({ seed: false });
    const { store, info } = t;
    const release = deferred();
    const held = store.withBook(info.id, async () => release.promise);
    let called = false;
    await expect(
      store.maintain(info.id, {
        kind: 'reconnect',
        timeoutMs: 20,
        prepare: async () => {
          called = true;
        },
      }),
    ).rejects.toMatchObject({ data: { code: 'MAINTENANCE_TIMEOUT' } });
    expect(called).toBe(false);
    release.resolve();
    await held;
    const finish = deferred();
    await expect(
      store.maintain(info.id, {
        kind: 'reconnect',
        timeoutMs: 20,
        prepare: async () => finish.promise,
      }),
    ).rejects.toMatchObject({ data: { code: 'MAINTENANCE_TIMEOUT' } });
    expect(() => store.open(info.id)).toThrow(/正在维护/);
    finish.resolve();
    await setImmediate();
    expect(store.open(info.id).raw.open).toBe(true);
  });

  it('同进程 realpath 别名共用维护门和目录占用；旧实例不能关闭新占用者', async () => {
    t = await createTestBook({ seed: false });
    const alias = path.join(t.dataDir, 'alias');
    symlinkSync(t.dataDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const shared = new BookStore({ ...options(), dataDir: alias });
    const entered = deferred(),
      finish = deferred();
    const maintaining = shared.maintain(t.info.id, {
      kind: 'reconnect',
      prepare: async () => {
        entered.resolve();
        await finish.promise;
      },
    });
    await entered.promise;
    expect(() => t!.store.open(t!.info.id)).toThrow(/正在维护/);
    finish.resolve();
    await maintaining;
    await shared.closeAll();
    await t.store.closeAll();
    const second = new BookStore(options());
    try {
      const owned = second.open(t.info.id);
      await t.store.closeAll();
      expect(owned.raw.open).toBe(true);
    } finally {
      await second.closeAll();
    }
    expect(t.store.open(t.info.id).raw.open).toBe(true);
  });

  it('未知残留锁不自动清除', async () => {
    t = await createTestBook({ seed: false });
    await t.store.closeAll();
    const lock = path.join(t.dataDir, '.caiwu-runtime.lock');
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.json'), '{"unknown":true}');
    expect(() => new BookStore(options())).toThrow(/未确认/);
    expect(readFileSync(path.join(lock, 'owner.json'), 'utf8')).toBe('{"unknown":true}');
  });
});
