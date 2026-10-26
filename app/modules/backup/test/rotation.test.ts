import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type * as FsPromises from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import backupServer from '../server';
import { backupService, waitForJobs } from '../server/service';
import { DEFAULT_SETTINGS } from '../shared';

const injected = vi.hoisted(() => ({ unlinkFailure: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (args[0] === injected.unlinkFailure)
        throw Object.assign(new Error('模拟受管文件删除权限失败'), { code: 'EACCES' });
      return actual.rm(...args);
    },
  };
});
let app: TestApp | undefined;
afterEach(async () => {
  injected.unlinkFailure = '';
  if (app) {
    await waitForJobs(app.runtime);
    await app.close();
    app = undefined;
  }
});
it('w_autobak：轮替删除失败只记录保留结果，新备份仍成功且旧文件保留', async () => {
  app = await createTestApp({ modules: [backupServer] });
  const token = await app.login();
  const session = app.runtime.sessions.get(token)!;
  const book = app.runtime.bookStore.open(app.book.id);
  const user = (await loadServiceUser(book.db, session.userId))!;
  const svc = backupService({
    app: app.runtime,
    session,
    book,
    user,
    moduleId: 'backup',
    svc: createCoreServices({
      db: book.db,
      user,
      moduleId: 'backup',
      now: app.runtime.now,
      modules: app.runtime.modules.lookup,
    }),
  });
  await svc.saveSettings({ ...DEFAULT_SETTINGS, keep: 1 });
  const first = await svc.create({ requestId: randomUUID(), name: '自动一' }, 'automatic', true);
  expect(first.status).toBe('valid');
  injected.unlinkFailure = path.join(
    app.runtime.dataDir,
    'backups',
    app.book.id,
    DEFAULT_SETTINGS.directory,
    `${first.id}.caiwubak`,
  );
  app.runtime.now = () => new Date(Date.now() + 60_000);
  const next = await svc.create({ requestId: randomUUID(), name: '自动二' }, 'automatic', true);
  expect(next.status).toBe('valid');
  expect(next.retention_note).toContain('轮替失败');
  expect(
    (await app.svc.log.list()).some(
      (r) => r.action === 'backup.retention' && r.summary.includes('轮替失败'),
    ),
  ).toBe(true);
  expect((await svc.list()).filter((r) => r.status === 'valid')).toHaveLength(2);
  expect((await svc.verify(first.id)).book.id).toBe(app.book.id);
});
