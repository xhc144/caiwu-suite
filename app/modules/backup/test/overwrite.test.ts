import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';
import { directory, packagePath, validatePackage } from '../server/files';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(backupServer, token);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  api = caller(app);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await waitForJobs(app.runtime);
  await app.close();
});
async function seed(amount: number) {
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: amount },
        { account: '6603', credit: amount },
      ],
    },
  ]);
}
async function preview() {
  await seed(12345);
  const item = await api.create({ name: '覆盖恢复源', requestId: randomUUID() });
  await waitForJobs(app.runtime);
  await seed(67890);
  return api.preview({ id: item.id, purpose: 'overwrite' });
}
const amounts = (raw: Database.Database) =>
  raw.prepare('SELECT debit_total FROM voucher ORDER BY id').all();

it('w_hf：完整覆盖保留目标ID与名称、回退整数金额、保留保护包并撤销所有旧会话', async () => {
  const observer = await app.addUser('observer', { permissions: ['backup.view'] });
  const p = await preview();
  expect(p.metadata.book.currentPeriod).toBe(202601);
  expect(p.targetBook.id).toBe(app.book.id);
  const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
  const protection = await api.prepareOverwrite({ planId: p.id });
  expect(stage.mock.calls[0]?.[0]).toMatchObject({
    sourceBookId: app.book.id,
    bookId: app.book.id,
  });
  expect(protection.available).toBe(true);
  const result = await api.restore({ planId: p.id, text: p.confirmation, password: 'admin' });
  expect(result).toMatchObject({
    bookId: app.book.id,
    name: app.book.name,
    purpose: 'overwrite',
    relogin: true,
  });
  const restored = app.runtime.bookStore.open(app.book.id);
  expect(amounts(restored.raw)).toEqual([{ debit_total: 12345 }]);
  expect(restored.raw.prepare('SELECT book_id,name FROM book_info').get()).toEqual({
    book_id: app.book.id,
    name: app.book.name,
  });
  await expect(api.list()).rejects.toThrow('登录已失效');
  expect(app.runtime.sessions.get(observer)).toBeNull();
  const fresh = caller(app, await app.login());
  const rows = await fresh.list();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: protection.protectionId,
    kind: 'pre-restore',
    status: 'valid',
  });
  const row = rows[0]!;
  const checked = await validatePackage(
    packagePath(await directory(app.runtime.dataDir, app.book.id, row.directory), row.id),
    app.runtime,
  );
  const before = new Database(checked.snapshot, { readonly: true });
  try {
    expect(amounts(before)).toEqual([{ debit_total: 12345 }, { debit_total: 67890 }]);
  } finally {
    before.close();
    const { rm } = await import('node:fs/promises');
    await rm(checked.snapshot);
  }
  expect(
    (await readdir(path.join(app.runtime.dataDir, 'core-protection', app.book.id))).filter((n) =>
      n.endsWith('.caiwu'),
    ),
  ).toHaveLength(1);
  expect(
    restored.raw
      .prepare("SELECT action FROM operation_log WHERE action='backup.restore.overwrite'")
      .all(),
  ).toHaveLength(1);
});

it('w_hf：恢复后校验失败由共享层真实回滚，财务数据与保护包均保留，须重新登录再预览', async () => {
  const p = await preview();
  const protection = await api.prepareOverwrite({ planId: p.id });
  const maintain = app.runtime.lifecycle.maintainBook.bind(app.runtime.lifecycle);
  vi.spyOn(app.runtime.lifecycle, 'maintainBook').mockImplementationOnce((input) =>
    maintain({
      ...input,
      plan: {
        ...input.plan,
        validate: async (book, signal) => {
          await input.plan.validate?.(book, signal);
          throw new Error('合成恢复校验故障');
        },
      },
    }),
  );
  await expect(
    api.restore({ planId: p.id, text: p.confirmation, password: 'admin' }),
  ).rejects.toThrow('覆盖恢复未完成');
  const restored = app.runtime.bookStore.open(app.book.id);
  expect(amounts(restored.raw)).toEqual([{ debit_total: 12345 }, { debit_total: 67890 }]);
  await expect(api.list()).rejects.toThrow('登录已失效');
  const fresh = caller(app, await app.login());
  expect(await fresh.verify({ id: protection.protectionId })).toMatchObject({
    type: 'pre-restore',
  });
  const next = await fresh.preview({ id: p.backup_id, purpose: 'overwrite' });
  expect((await fresh.prepareOverwrite({ planId: next.id })).available).toBe(true);
});

it('w_hf：预览后另一个SQLite连接提交也会失效，不能依赖当前连接的total_changes', async () => {
  const p = await preview();
  const external = new Database(app.runtime.bookStore.pathOf(app.book.id));
  try {
    external.prepare("UPDATE book_info SET org_name='合成变化' WHERE id=1").run();
  } finally {
    external.close();
  }
  await expect(api.prepareOverwrite({ planId: p.id })).rejects.toThrow('发生变化');
  expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toHaveLength(2);
});

it('w_hf：准备后取消或错密码、错文字均不能覆盖，保护备份保持可用', async () => {
  const p = await preview();
  const protection = await api.prepareOverwrite({ planId: p.id });
  await expect(
    api.restore({ planId: p.id, text: p.confirmation, password: 'wrong' }),
  ).rejects.toThrow('密码');
  await expect(
    api.restore({ planId: p.id, text: '覆盖其他账套', password: 'admin' }),
  ).rejects.toThrow('确认文字');
  await api.cancelPlan({ id: p.id });
  await expect(
    api.restore({ planId: p.id, text: p.confirmation, password: 'admin' }),
  ).rejects.toThrow('取消或过期');
  expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toHaveLength(2);
  expect(await api.verify({ id: protection.protectionId })).toMatchObject({ type: 'pre-restore' });
});

it('w_hf：另一电脑的备份覆盖本机账套，暂存绑定来源ID与目标ID，目标名称和编号不变', async () => {
  const source = await preview();
  const portable = await api.download({ id: source.backup_id });
  const machine = await createTestApp({ modules: [backupServer] });
  try {
    const destination = caller(machine);
    const imported = await destination.upload({ name: '来自另一电脑', base64: portable.base64 });
    const plan = await destination.preview({ id: imported.id, purpose: 'overwrite' });
    expect(plan.metadata.book.id).toBe(app.book.id);
    expect(plan.target_id).toBe(machine.book.id);
    const stage = vi.spyOn(machine.runtime.bookStore, 'prepareReplacement');
    await destination.prepareOverwrite({ planId: plan.id });
    expect(stage.mock.calls[0]?.[0]).toMatchObject({
      sourceBookId: app.book.id,
      bookId: machine.book.id,
    });
    await destination.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' });
    const restored = machine.runtime.bookStore.open(machine.book.id);
    expect(restored.raw.prepare('SELECT book_id,name FROM book_info').get()).toEqual({
      book_id: machine.book.id,
      name: machine.book.name,
    });
    expect(amounts(restored.raw)).toEqual([{ debit_total: 12345 }]);
    expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toHaveLength(2);
  } finally {
    await waitForJobs(machine.runtime);
    await machine.close();
  }
});
