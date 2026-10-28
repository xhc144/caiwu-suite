import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import type { CoreServices } from '@caiwu/core/server';
import { BusinessError } from '@caiwu/core';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import backupServer from '../server';
import { backupService, waitForJobs } from '../server/service';
import { TRANSFER_LIMIT } from '../shared';
import { directory, packagePath, validatePackage } from '../server/files';

const snapshotFault = vi.hoisted(() => ({ mode: null as 'length' | 'digest' | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof Fs>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const result = await actual.readFile(...args);
      if (snapshotFault.mode && String(args[0]).endsWith('.checking') && Buffer.isBuffer(result)) {
        if (snapshotFault.mode === 'length') return result.subarray(0, result.length - 1);
        const changed = Buffer.from(result);
        changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
        return changed;
      }
      return result;
    },
  };
});
let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(backupServer, token);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  api = caller(app);
});
afterEach(async () => {
  snapshotFault.mode = null;
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
  const authorizedServices: CoreServices[] = [];
  const maintain = app.runtime.lifecycle.maintainBook.bind(app.runtime.lifecycle);
  vi.spyOn(app.runtime.lifecycle, 'maintainBook').mockImplementationOnce((input) =>
    maintain({
      ...input,
      authorize: async (svc) => {
        authorizedServices.push(svc);
        await input.authorize(svc);
      },
    }),
  );
  const result = await api.restore({ planId: p.id, text: p.confirmation, password: 'admin' });
  expect(authorizedServices).toHaveLength(2);
  expect(authorizedServices[0]).not.toBe(authorizedServices[1]);
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
  expect(rows.map((row) => row.id).sort()).toEqual([p.backup_id, protection.protectionId].sort());
  expect(rows.find((row) => row.id === protection.protectionId)).toMatchObject({
    id: protection.protectionId,
    kind: 'pre-restore',
    status: 'valid',
  });
  const row = rows.find((row) => row.id === protection.protectionId)!;
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
  const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
  const protection = await api.prepareOverwrite({ planId: p.id });
  const ticket = await stage.mock.results[0]!.value;
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
  const cancelReplacement = vi.fn().mockResolvedValue(undefined);
  Object.assign(app.runtime.bookStore, { cancelReplacement });
  try {
    await fresh.cancelPlan({ id: p.id });
    expect(cancelReplacement).toHaveBeenCalledWith({
      bookId: app.book.id,
      replacementId: ticket.replacementId,
    });
  } finally {
    Reflect.deleteProperty(app.runtime.bookStore, 'cancelReplacement');
  }
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

it.each(['length', 'digest'] as const)(
  'w_hf：已校验快照暂存前%s变化，禁止调用共享暂存；原账与保护包保留',
  async (mode) => {
    const p = await preview();
    const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
    snapshotFault.mode = mode;
    await expect(api.prepareOverwrite({ planId: p.id })).rejects.toThrow(
      '已校验快照在暂存前发生变化',
    );
    snapshotFault.mode = null;
    expect(stage).not.toHaveBeenCalled();
    expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toHaveLength(2);
    const protection = (await api.list()).find((row) => row.kind === 'pre-restore')!;
    expect(protection.status).toBe('valid');
    expect(await api.verify({ id: protection.id })).toMatchObject({ type: 'pre-restore' });
  },
);

it('w_hf：跨机覆盖清除源机器失效路径，保留本机手动、自动、上传及历史保护目录，大包仍可直接恢复', async () => {
  const machine = await createTestApp({ modules: [backupServer] });
  try {
    let destination = caller(machine);
    await seedVouchers(machine.svc, [
      {
        date: '2026-01-05',
        lines: [
          { account: '1001', debit: 22222 },
          { account: '6603', credit: 22222 },
        ],
      },
    ]);
    const targetRaw = machine.runtime.bookStore.open(machine.book.id).raw;
    const largeLog = targetRaw
      .prepare('INSERT INTO operation_log(at,module,action,summary,detail) VALUES (?,?,?,?,?)')
      .run(
        new Date().toISOString(),
        'backup',
        'backup.test.large',
        '合成大包',
        'x'.repeat(33 * 1024 * 1024),
      );
    const manual = await destination.create({ requestId: randomUUID(), name: '本机大包手动备份' });
    await waitForJobs(machine.runtime);
    const manualBefore = (await destination.list()).find((row) => row.id === manual.id)!;
    expect(manualBefore.bytes).toBeGreaterThan(TRANSFER_LIMIT);
    targetRaw.prepare('DELETE FROM operation_log WHERE id=?').run(largeLog.lastInsertRowid);
    targetRaw.exec('VACUUM');
    const token = await machine.login();
    const localSvc = machine.svcFor('backup');
    const local = backupService({
      app: machine.runtime,
      book: machine.runtime.bookStore.open(machine.book.id),
      session: machine.runtime.sessions.get(token)!,
      user: localSvc.ctx.user,
      svc: localSvc,
      moduleId: 'backup',
    });
    const automatic = await local.create(
      { requestId: randomUUID(), name: '本机自动备份' },
      'automatic',
      true,
    );
    const historical = await local.create(
      { requestId: randomUUID(), name: '本机历史保护' },
      'pre-restore',
      true,
    );

    await seed(12345);
    const sourceRaw = app.runtime.bookStore.open(app.book.id).raw;
    // 与本机手动包故意使用相同ID，但源记录指向源机器的非法路径；不能覆盖本机登记。
    sourceRaw
      .prepare(
        'INSERT INTO backup_item(id,owner_id,request_id,name,directory,kind,status,created_at,digest) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        manual.id,
        app.book.id,
        randomUUID(),
        '源机器失效引用',
        '../源机器旧目录',
        'manual',
        'valid',
        new Date().toISOString(),
        '0'.repeat(64),
      );
    const stalePlan = randomUUID();
    sourceRaw
      .prepare(
        'INSERT INTO backup_plan(id,owner_id,user_id,backup_id,digest,target_id,target_name,purpose,expires_at,status,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        stalePlan,
        app.book.id,
        1,
        manual.id,
        '0'.repeat(64),
        randomUUID(),
        '源机器旧计划',
        'copy',
        '2030-01-01T00:00:00.000Z',
        'ready',
        '',
        new Date().toISOString(),
      );
    const source = await api.create({ requestId: randomUUID(), name: '跨机来源包' });
    await waitForJobs(app.runtime);
    const portable = await api.download({ id: source.id });
    const imported = await destination.upload({ name: '本机上传来源包', base64: portable.base64 });
    const before = await destination.list();
    expect(before.map((row) => row.id).sort()).toEqual(
      [manual.id, automatic.id, historical.id, imported.id].sort(),
    );
    const plan = await destination.preview({ id: imported.id, purpose: 'overwrite' });
    const protection = await destination.prepareOverwrite({ planId: plan.id });
    await destination.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' });
    destination = caller(machine, await machine.login());
    const retained = await destination.list();
    expect(retained.map((row) => row.id).sort()).toEqual(
      [...before.map((row) => row.id), protection.protectionId].sort(),
    );
    for (const row of before) expect(retained.find((saved) => saved.id === row.id)).toEqual(row);
    expect(
      retained.every((row) => row.owner_id === machine.book.id && row.status === 'valid'),
    ).toBe(true);
    expect(retained.some((row) => row.directory.includes('源机器'))).toBe(false);
    const replaced = machine.runtime.bookStore.open(machine.book.id);
    expect(replaced.raw.prepare('SELECT count(*) n FROM backup_plan').get()).toEqual({ n: 0 });
    expect(amounts(replaced.raw)).toEqual([{ debit_total: 12345 }]);
    await expect(destination.download({ id: manual.id })).rejects.toThrow('32 MiB');
    for (const row of retained) {
      destination = caller(machine, await machine.login());
      expect(await destination.verify({ id: row.id })).toMatchObject({
        book: { id: row.metadata!.book.id },
      });
      const copy = await destination.preview({
        id: row.id,
        purpose: 'copy',
        name: `本机历史-${row.kind}-${row.id.slice(0, 8)}`,
      });
      const restored = await destination.restore({
        planId: copy.id,
        text: copy.confirmation,
        password: 'admin',
      });
      expect(restored.bookId).not.toBe(machine.book.id);
      const book = machine.runtime.bookStore.open(restored.bookId);
      expect(amounts(book.raw)).toEqual([{ debit_total: row.kind === 'imported' ? 12345 : 22222 }]);
      expect(book.raw.prepare('SELECT count(*) n FROM backup_item').get()).toEqual({ n: 0 });
    }
  } finally {
    await waitForJobs(machine.runtime);
    await machine.close();
  }
});

it('w_hf：共享取消接口存在时绑定目标和准备票据；共享拒绝则保留计划，成功后才取消计划', async () => {
  const plan = await preview();
  const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
  await api.prepareOverwrite({ planId: plan.id });
  const ticket = await stage.mock.results[0]!.value;
  const cancelReplacement = vi
    .fn()
    .mockRejectedValueOnce(
      new BusinessError({ code: 'RESTORE_APPLYING', message: '恢复正在应用，不能取消' }),
    )
    .mockResolvedValueOnce(undefined);
  Object.assign(app.runtime.bookStore, { cancelReplacement });
  try {
    await expect(api.cancelPlan({ id: plan.id })).rejects.toThrow('恢复正在应用');
    expect(
      app.runtime.bookStore
        .open(app.book.id)
        .raw.prepare('SELECT status FROM backup_plan WHERE id=?')
        .get(plan.id),
    ).toEqual({ status: 'ready' });
    await api.cancelPlan({ id: plan.id });
    expect(cancelReplacement.mock.calls).toEqual([
      [{ bookId: app.book.id, replacementId: ticket.replacementId }],
      [{ bookId: app.book.id, replacementId: ticket.replacementId }],
    ]);
    await expect(
      api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' }),
    ).rejects.toThrow('取消或过期');
    expect(
      app.runtime.bookStore
        .open(app.book.id)
        .raw.prepare('SELECT status FROM backup_plan WHERE id=?')
        .get(plan.id),
    ).toEqual({ status: 'cancelled' });
  } finally {
    Reflect.deleteProperty(app.runtime.bookStore, 'cancelReplacement');
  }
});

it('w_hf：共享票据已done而清理报错时仍返回真实恢复成功和待清理提示，不再触发恢复失败', async () => {
  const plan = await preview();
  await api.prepareOverwrite({ planId: plan.id });
  const maintain = app.runtime.lifecycle.maintainBook.bind(app.runtime.lifecycle);
  const status = app.runtime.bookStore.replacementStatus.bind(app.runtime.bookStore);
  vi.spyOn(app.runtime.bookStore, 'replacementStatus').mockImplementation((id) => ({
    ...status(id),
    stagingRetained: true,
    cleanupPending: true,
  }));
  vi.spyOn(app.runtime.lifecycle, 'maintainBook').mockImplementationOnce(async (input) => {
    await maintain(input);
    throw new Error('合成：数据库恢复完成后暂存清理失败');
  });
  const result = await api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' });
  expect(result).toMatchObject({
    bookId: app.book.id,
    purpose: 'overwrite',
    relogin: true,
    cleanupPending: true,
  });
  expect(amounts(app.runtime.bookStore.open(app.book.id).raw)).toEqual([{ debit_total: 12345 }]);
  await expect(api.list()).rejects.toThrow('登录已失效');
});
