import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import backup from '../../../modules/backup/server';
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
});
