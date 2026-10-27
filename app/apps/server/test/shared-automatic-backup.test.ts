import Database from 'better-sqlite3';
import { renameSync, symlinkSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backup from '../../../modules/backup/server';
import { packagePath, validatePackage } from '../../../modules/backup/server/files';
import { createRuntime } from '@caiwu/server-kit';
import { withAutomaticBackup } from '../src/automatic-backup';
let app: TestApp;
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
});
it('w_autobak：启动、定时、正常退出真实备份，不依赖页面；关闭缓存后定时任务重取连接', async () => {
  const callbacks = new Map<number, () => void>();
  let sequence = 0;
  const module = withAutomaticBackup(backup, {
    now: Date.now,
    set: (fn) => {
      const id = ++sequence;
      callbacks.set(id, () => {
        callbacks.delete(id);
        fn();
      });
      return id;
    },
    clear: (id) => {
      callbacks.delete(id as number);
    },
  });
  app = await createTestApp({ modules: [module] });
  const api = app.call(module);
  const first = await api.list();
  expect(first.filter((row) => row.kind === 'automatic' && row.status === 'valid')).toHaveLength(1);
  await app.runtime.bookStore.close(app.book.id);
  const timer = [...callbacks.values()].at(-1)!;
  timer();
  await expect
    .poll(
      async () =>
        (await api.list()).filter((row) => row.kind === 'automatic' && row.status === 'valid')
          .length,
    )
    .toBe(2);
  const file = app.runtime.bookStore.pathOf(app.book.id);
  await app.runtime.lifecycle.stop();
  const raw = new Database(file, { readonly: true });
  try {
    expect(
      raw
        .prepare("SELECT count(*) AS n FROM backup_item WHERE kind='automatic' AND status='valid'")
        .get(),
    ).toEqual({ n: 3 });
  } finally {
    raw.close();
  }
  expect(callbacks.size).toBe(0);
  // A real process start discovers an existing book without visiting the backup page.
  const restarted = await createRuntime({
    dataDir: app.runtime.dataDir,
    modules: [
      withAutomaticBackup(backup, {
        now: Date.now,
        set: (fn) => {
          const id = ++sequence;
          callbacks.set(id, fn);
          return id;
        },
        clear: (id) => {
          callbacks.delete(id as number);
        },
      }),
    ],
    devMode: true,
  });
  try {
    await restarted.lifecycle.start();
    const existing = restarted.bookStore.open(app.book.id).raw;
    expect(
      existing
        .prepare("SELECT count(*) AS n FROM backup_item WHERE kind='automatic' AND status='valid'")
        .get(),
    ).toEqual({ n: 4 });
    await restarted.lifecycle.stop();
    const stopped = new Database(file, { readonly: true });
    try {
      expect(
        stopped
          .prepare(
            "SELECT count(*) AS n FROM backup_item WHERE kind='automatic' AND status='valid'",
          )
          .get(),
      ).toEqual({ n: 5 });
    } finally {
      stopped.close();
    }
  } finally {
    await restarted.lifecycle.stop();
  }
  expect(callbacks.size).toBe(0);
});

it('w_autobak：真实退出备份失败不释放账套；关闭缓存、修复受管目录后同一实例可重试', async () => {
  const callbacks = new Set<() => void>();
  const module = withAutomaticBackup(backup, {
    now: Date.now,
    set: (fn) => {
      callbacks.add(fn);
      return fn;
    },
    clear: (id) => {
      callbacks.delete(id as () => void);
    },
  });
  app = await createTestApp({ modules: [module] });
  const store = app.runtime.bookStore;
  const file = store.pathOf(app.book.id);
  const directory = path.join(app.runtime.dataDir, 'backups');
  const saved = path.join(app.runtime.dataDir, 'saved-backups');
  renameSync(directory, saved);
  symlinkSync(saved, directory, 'dir');
  try {
    await expect(app.runtime.lifecycle.stop()).rejects.toThrow(/退出备份失败/);
    expect(app.runtime.lifecycle.state).toBe('failed');
    expect(store.open(app.book.id).raw.pragma('integrity_check', { simple: true })).toBe('ok');
    await store.close(app.book.id);
    unlinkSync(directory);
    renameSync(saved, directory);
    await app.runtime.lifecycle.stop();
    expect(app.runtime.lifecycle.state).toBe('stopped');
    const raw = new Database(file, { readonly: true });
    try {
      expect(
        raw
          .prepare(
            "SELECT count(*) AS n FROM backup_item WHERE kind='automatic' AND status='valid'",
          )
          .get(),
      ).toEqual({ n: 2 });
      expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      raw.close();
    }
    expect(callbacks.size).toBe(0);
  } finally {
    if (existsSync(saved)) {
      if (existsSync(directory)) unlinkSync(directory);
      renameSync(saved, directory);
    }
  }
});

it.each([false, true])(
  'w_autobak：onExit=false定时失败后禁用=%s，退出仍须真实重试并备份新提交',
  async (disabled) => {
    const callbacks = new Map<object, () => void>();
    const module = withAutomaticBackup(backup, {
      now: Date.now,
      set: (fn) => {
        const id = {};
        callbacks.set(id, () => {
          callbacks.delete(id);
          fn();
        });
        return id;
      },
      clear: (id) => {
        callbacks.delete(id as object);
      },
    });
    app = await createTestApp({ modules: [module] });
    const api = app.call(module);
    await api.saveSettings({
      enabled: true,
      directory: '自动备份',
      onStart: true,
      onExit: false,
      intervalMinutes: 5,
      keep: 10,
    });
    const spy = vi
      .spyOn(Database.prototype, 'backup')
      .mockRejectedValue(new Error('SQLITE_IOERR: 定时备份失败'));
    [...callbacks.values()].at(-1)!();
    await expect
      .poll(async () => (await api.list()).filter((row) => row.status === 'failed').length)
      .toBe(1);
    if (disabled)
      await api.saveSettings({
        enabled: false,
        directory: '自动备份',
        onStart: true,
        onExit: false,
        intervalMinutes: 5,
        keep: 10,
      });
    await expect(app.runtime.lifecycle.stop()).rejects.toThrow(/退出备份失败/);
    expect(app.runtime.lifecycle.state).toBe('failed');
    if (disabled) expect(callbacks.size).toBe(0);
    else expect(callbacks.size).toBeGreaterThan(0);
    spy.mockRestore();
    await app.svc.settings.set('after-failure', '新的真实提交');
    const file = app.runtime.bookStore.pathOf(app.book.id);
    await app.runtime.lifecycle.stop();
    expect(app.runtime.lifecycle.state).toBe('stopped');
    expect(callbacks.size).toBe(0);
    const raw = new Database(file, { readonly: true });
    let newest!: { id: string; directory: string };
    try {
      expect(
        raw
          .prepare(
            "SELECT count(*) AS n FROM backup_item WHERE status='valid' AND kind='automatic'",
          )
          .get(),
      ).toEqual({ n: 2 });
      expect(raw.prepare("SELECT value FROM book_setting WHERE key='after-failure'").get()).toEqual(
        {
          value: '"新的真实提交"',
        },
      );
      newest = raw
        .prepare(
          "SELECT id,directory FROM backup_item WHERE status='valid' ORDER BY created_at DESC,id DESC LIMIT 1",
        )
        .get() as typeof newest;
    } finally {
      raw.close();
    }
    const checked = await validatePackage(
      packagePath(
        path.join(app.runtime.dataDir, 'backups', app.book.id, newest.directory),
        newest.id,
      ),
      app.runtime,
    );
    const snapshot = new Database(checked.snapshot, { readonly: true });
    try {
      expect(
        snapshot.prepare("SELECT value FROM book_setting WHERE key='after-failure'").get(),
      ).toEqual({ value: '"新的真实提交"' });
    } finally {
      snapshot.close();
      rmSync(checked.snapshot, { force: true });
    }
  },
);

it('w_autobak：退出备份成功后宿主关闭失败，再次退出仍备份新的真实提交', async () => {
  const callbacks = new Set<() => void>();
  const module = withAutomaticBackup(backup, {
    now: Date.now,
    set: (fn) => {
      callbacks.add(fn);
      return fn;
    },
    clear: (id) => callbacks.delete(id as () => void),
  });
  app = await createTestApp({ modules: [module] });
  const store = app.runtime.bookStore;
  const file = store.pathOf(app.book.id);
  vi.spyOn(store, 'dispose').mockRejectedValueOnce(new Error('SQLITE_IOERR: 宿主关闭失败'));
  await expect(app.runtime.lifecycle.stop()).rejects.toThrow(/宿主关闭失败/);
  expect(app.runtime.lifecycle.state).toBe('failed');
  const prior = new Set(
    (
      store.open(app.book.id).raw.prepare('SELECT id FROM backup_item').all() as { id: string }[]
    ).map((row) => row.id),
  );
  await app.svc.settings.set('after-host-failure', '关闭失败后的新提交');
  await app.runtime.lifecycle.stop();
  expect(app.runtime.lifecycle.state).toBe('stopped');
  expect(callbacks.size).toBe(0);
  const raw = new Database(file, { readonly: true });
  let latest!: { id: string; directory: string };
  try {
    const rows = raw
      .prepare("SELECT id,directory FROM backup_item WHERE kind='automatic' AND status='valid'")
      .all() as { id: string; directory: string }[];
    expect(rows).toHaveLength(3);
    const added = rows.filter((row) => !prior.has(row.id));
    expect(added).toHaveLength(1);
    latest = added[0]!;
  } finally {
    raw.close();
  }
  const checked = await validatePackage(
    packagePath(
      path.join(app.runtime.dataDir, 'backups', app.book.id, latest.directory),
      latest.id,
    ),
    app.runtime,
  );
  const snapshot = new Database(checked.snapshot, { readonly: true });
  try {
    expect(
      snapshot.prepare("SELECT value FROM book_setting WHERE key='after-host-failure'").get(),
    ).toEqual({ value: '"关闭失败后的新提交"' });
  } finally {
    snapshot.close();
    rmSync(checked.snapshot, { force: true });
  }
});

it.each(['record', 'log'] as const)(
  'w_autobak：onExit=false定时失败且%s落库失败，修复后真实补写终态并退出，新备份保留新提交',
  async (fault) => {
    const callbacks = new Set<() => void>();
    const module = withAutomaticBackup(backup, {
      now: Date.now,
      set: (fn) => {
        const callback = () => {
          callbacks.delete(callback);
          fn();
        };
        callbacks.add(callback);
        return callback;
      },
      clear: (id) => callbacks.delete(id as () => void),
    });
    app = await createTestApp({ modules: [module] });
    const api = app.call(module);
    await api.saveSettings({
      enabled: true,
      directory: '自动备份',
      onStart: true,
      onExit: false,
      intervalMinutes: 5,
      keep: 10,
    });
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    const original = new Set(
      (raw.prepare('SELECT id FROM backup_item').all() as { id: string }[]).map((row) => row.id),
    );
    raw.exec(
      fault === 'record'
        ? "CREATE TRIGGER terminal_fault BEFORE UPDATE ON backup_item WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'合成终态记录不可写'); END"
        : "CREATE TRIGGER terminal_fault BEFORE INSERT ON operation_log WHEN NEW.action='backup.failed' BEGIN SELECT RAISE(ABORT,'合成终态日志不可写'); END",
    );
    const spy = vi
      .spyOn(Database.prototype, 'backup')
      .mockRejectedValue(new Error('SQLITE_IOERR: 合成定时失败'));
    try {
      [...callbacks].at(-1)!();
      await expect.poll(() => callbacks.size).toBeGreaterThan(0);
      await expect(app.runtime.lifecycle.stop()).rejects.toThrow(/退出备份失败/);
      expect(raw.open).toBe(true);
      expect(
        raw.prepare("SELECT count(*) AS n FROM operation_log WHERE action='backup.failed'").get(),
      ).toEqual({ n: 0 });
      spy.mockRestore();
      raw.exec('DROP TRIGGER terminal_fault');
      await app.svc.settings.set('terminal-repair-commit', '故障修复后的新提交');
      const file = app.runtime.bookStore.pathOf(app.book.id);
      await app.runtime.lifecycle.stop();
      expect(app.runtime.lifecycle.state).toBe('stopped');
      expect(callbacks.size).toBe(0);
      const closed = new Database(file, { readonly: true });
      let latest!: { id: string; directory: string };
      try {
        expect(
          closed.prepare("SELECT count(*) AS n FROM backup_item WHERE status='running'").get(),
        ).toEqual({ n: 0 });
        expect(
          closed.prepare("SELECT count(*) AS n FROM backup_item WHERE status='failed'").get(),
        ).toEqual({ n: 2 });
        expect(
          closed
            .prepare(
              "SELECT count(*) AS n FROM operation_log WHERE action='backup.failed' AND user_id=1 AND user_name='系统管理员'",
            )
            .get(),
        ).toEqual({ n: 2 });
        const rows = closed
          .prepare("SELECT id,directory FROM backup_item WHERE status='valid'")
          .all() as { id: string; directory: string }[];
        expect(rows).toHaveLength(2);
        latest = rows.find((row) => !original.has(row.id))!;
      } finally {
        closed.close();
      }
      const checked = await validatePackage(
        packagePath(
          path.join(app.runtime.dataDir, 'backups', app.book.id, latest.directory),
          latest.id,
        ),
        app.runtime,
      );
      const snapshot = new Database(checked.snapshot, { readonly: true });
      try {
        expect(
          snapshot
            .prepare("SELECT value FROM book_setting WHERE key='terminal-repair-commit'")
            .get(),
        ).toEqual({ value: '"故障修复后的新提交"' });
      } finally {
        snapshot.close();
        rmSync(checked.snapshot, { force: true });
      }
    } finally {
      spy.mockRestore();
      if (raw.open) raw.exec('DROP TRIGGER IF EXISTS terminal_fault');
    }
  },
);
