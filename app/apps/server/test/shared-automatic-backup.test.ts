import Database from 'better-sqlite3';
import { renameSync, symlinkSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backup from '../../../modules/backup/server';
import { createRuntime } from '@caiwu/server-kit';
import { withAutomaticBackup } from '../src/automatic-backup';
let app: TestApp;
afterEach(async () => app?.close());
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
