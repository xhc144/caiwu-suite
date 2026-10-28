import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { ResetParameters } from '../shared';
import { cancelReset } from '../server/reset';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
const parameters: ResetParameters = {
  name: '重新初始化后的合成账套',
  orgName: '合成单位',
  templateId: 'demo-enterprise',
  codeScheme: '4-3-3',
  startYear: 2027,
  startMonth: 6,
  numbering: 'manual',
};
const prepare = () => app.call(server).reset.prepare({ parameters, password: 'admin' });
const execution = (planId: string) => ({
  planId,
  confirmBookName: app.book.name,
  password: 'admin',
  confirmed: true as const,
  confirmation: '重新初始化' as const,
});
const hash = () =>
  createHash('sha256')
    .update(app.runtime.bookStore.open(app.book.id).raw.serialize())
    .digest('hex');
const stagedFiles = () => {
  const directory = path.join(app.runtime.dataDir, 'restore-staging');
  return existsSync(directory)
    ? readdirSync(directory).filter((file) => file.endsWith('.sqlite'))
    : [];
};
describe('w_xt_kgzb_1 / _2 / _3 完整重新初始化', () => {
  it('取消只清理当前登录的受管预览，重复取消幂等；原账不变且已取消计划不能执行', async () => {
    const api = app.call(server);
    const other = await app.login();
    const before = hash();
    const plan = await prepare();
    expect(stagedFiles()).toHaveLength(1);
    await expect(app.call(server, other).reset.cancel({ planId: plan.planId })).rejects.toThrow(
      '不属于当前登录',
    );
    expect(stagedFiles()).toHaveLength(1);
    expect(await api.reset.cancel({ planId: plan.planId })).toMatchObject({
      ok: true,
      status: 'cancelled',
      stagingRetained: false,
      cleanupPending: false,
    });
    expect(await api.reset.cancel({ planId: plan.planId })).toMatchObject({ status: 'cancelled' });
    expect(stagedFiles()).toHaveLength(0);
    expect(hash()).toBe(before);
    await expect(api.reset.execute(execution(plan.planId))).rejects.toThrow('预览已过期');
    expect(hash()).toBe(before);
  });

  it('过期预览由共享清理器回收，执行拒绝；不扫描孤立文件且不改变原账', async () => {
    const plan = await prepare();
    const before = hash();
    const orphan = path.join(app.runtime.dataDir, 'restore-staging', 'unregistered.sqlite');
    writeFileSync(orphan, '非受管合成文件');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(plan.expiresAt + 1);
    try {
      await expect(app.call(server).reset.execute(execution(plan.planId))).rejects.toThrow(
        '预览已过期',
      );
      expect(stagedFiles()).toEqual(['unregistered.sqlite']);
      expect(readFileSync(orphan, 'utf8')).toBe('非受管合成文件');
      expect(hash()).toBe(before);
    } finally {
      clock.mockRestore();
    }
  });

  it('过期预览经预检清理后，本登录仍可幂等取消；其他登录及账套拒绝，执行始终拒绝', async () => {
    const api = app.call(server);
    const other = await app.login();
    const foreign = await app.runtime.bookStore.create({
      name: '独立合成账套',
      orgName: '独立合成单位',
      templateId: 'demo-enterprise',
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'admin',
    });
    const foreignLogin = await app
      .core(null)
      .auth.login({ bookId: foreign.id, userCode: 'admin', password: 'admin' });
    const plan = await prepare();
    const before = hash();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(plan.expiresAt + 1);
    try {
      await api.reset.preflight();
      expect(stagedFiles()).toHaveLength(0);
      await expect(app.call(server, other).reset.cancel({ planId: plan.planId })).rejects.toThrow(
        '不属于当前登录',
      );
      await expect(
        app.call(server, foreignLogin.token).reset.cancel({ planId: plan.planId }),
      ).rejects.toThrow('不属于当前登录');
      await expect(api.reset.execute(execution(plan.planId))).rejects.toThrow('预览已过期');
      expect(await api.reset.cancel({ planId: plan.planId })).toMatchObject({
        ok: true,
        status: 'expired',
        stagingRetained: false,
        cleanupPending: false,
      });
      expect(await api.reset.cancel({ planId: plan.planId })).toMatchObject({
        ok: true,
        status: 'expired',
      });
      await expect(api.reset.execute(execution(plan.planId))).rejects.toThrow('预览已过期');
      expect(hash()).toBe(before);
      expect((await app.core().auth.me()).book.id).toBe(app.book.id);
    } finally {
      clock.mockRestore();
    }
  });

  it('取消已逻辑生效但清理失败时，执行在维护前拒绝且不撤销会话；修复后可重试清理，真实保护备份完整保留', async () => {
    const result = await app.call(server).reset.execute(execution((await prepare()).planId));
    const token = await app.login();
    const api = app.call(server, token);
    const plan = await api.reset.prepare({ parameters, password: 'admin' });
    const protection = path.join(
      app.runtime.dataDir,
      'core-protection',
      app.book.id,
      `${result.protectionId}.caiwu`,
    );
    const protectedBytes = readFileSync(protection);
    const directory = path.join(app.runtime.dataDir, 'restore-staging');
    const held = directory + '-held';
    const maintain = vi.spyOn(app.runtime.lifecycle, 'maintainBook');
    renameSync(directory, held);
    mkdirSync(directory);
    try {
      await expect(api.reset.cancel({ planId: plan.planId })).rejects.toThrow('暂存未能清理');
      expect(readdirSync(held).filter((file) => file.endsWith('.sqlite'))).toHaveLength(1);
      await expect(
        api.reset.execute({ ...execution(plan.planId), confirmBookName: parameters.name }),
      ).rejects.toThrow('预览已过期');
      expect(maintain).not.toHaveBeenCalled();
      expect((await app.core(token).auth.me()).book.name).toBe(parameters.name);
      expect(readFileSync(protection)).toEqual(protectedBytes);
    } finally {
      maintain.mockRestore();
      rmSync(directory, { recursive: true });
      renameSync(held, directory);
    }
    expect(await api.reset.cancel({ planId: plan.planId })).toMatchObject({
      ok: true,
      status: 'cancelled',
      stagingRetained: false,
      cleanupPending: false,
    });
    expect(stagedFiles()).toHaveLength(0);
    expect(readFileSync(protection)).toEqual(protectedBytes);
  });

  it('准备后实时撤销管理员，旧登录不能执行或取消，既有预览不被误删', async () => {
    const token = await app.addUser('revoked-admin', { isAdmin: true, password: 'synthetic123' });
    const api = app.call(server, token);
    const plan = await api.reset.prepare({ parameters, password: 'synthetic123' });
    await app.svc.db
      .updateTable('app_user')
      .set({ is_admin: 0 })
      .where('code', '=', 'revoked-admin')
      .execute();
    const before = hash();
    await expect(
      api.reset.execute({ ...execution(plan.planId), password: 'synthetic123' }),
    ).rejects.toThrow();
    await expect(api.reset.cancel({ planId: plan.planId })).rejects.toThrow();
    expect(hash()).toBe(before);
    expect(stagedFiles()).toHaveLength(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(plan.expiresAt + 1);
    try {
      await app.call(server).reset.preflight();
      expect(stagedFiles()).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('应用中拒绝取消；数据提交后清理故障仍返回成功，保护备份保留且不可重做初始化', async () => {
    const store = app.runtime.bookStore;
    const token = await app.login();
    const session = app.runtime.sessions.get(token)!;
    const api = app.call(server, token);
    const plan = await api.reset.prepare({ parameters, password: 'admin' });
    const directory = path.join(app.runtime.dataDir, 'restore-staging');
    const held = directory + '-held';
    let replacementId = '';
    const maintain = app.runtime.lifecycle.maintainBook.bind(app.runtime.lifecycle);
    const fault = vi
      .spyOn(app.runtime.lifecycle, 'maintainBook')
      .mockImplementationOnce(async (input) => {
        replacementId = input.plan.replacementId!;
        return maintain({
          ...input,
          plan: {
            ...input.plan,
            validate: async (opened, signal) => {
              expect(() => cancelReset(app.runtime, session, plan.planId)).toThrow('恢复正在应用');
              await input.plan.validate?.(opened, signal);
              renameSync(directory, held);
              mkdirSync(directory);
            },
          },
        });
      });
    try {
      const result = await api.reset.execute(execution(plan.planId));
      expect(result).toMatchObject({ ok: true, relogin: true, cleanupPending: true });
      expect(store.replacementStatus(replacementId)).toMatchObject({
        status: 'done',
        stagingRetained: true,
        cleanupPending: true,
      });
      expect(
        existsSync(
          path.join(
            app.runtime.dataDir,
            'core-protection',
            app.book.id,
            `${result.protectionId}.caiwu`,
          ),
        ),
      ).toBe(true);
      await expect(api.reset.execute(execution(plan.planId))).rejects.toThrow('登录已失效');
      const freshToken = await app.login();
      expect((await app.core(freshToken).auth.me()).book.name).toBe(parameters.name);
    } finally {
      fault.mockRestore();
      if (existsSync(held)) {
        rmSync(directory, { recursive: true });
        renameSync(held, directory);
      }
      if (replacementId) store.cancelReplacement({ bookId: app.book.id, replacementId });
    }
    expect(stagedFiles()).toHaveLength(0);
    expect(store.replacementStatus(replacementId)).toMatchObject({
      status: 'done',
      cleanupPending: false,
    });
  });

  it('替换及回滚双故障隔离，取消不能删除暂存或保护副本；修复后用原管理员恢复再清理', async () => {
    const store = app.runtime.bookStore;
    const token = await app.login();
    const session = app.runtime.sessions.get(token)!;
    const api = app.call(server, token);
    const plan = await api.reset.prepare({ parameters, password: 'admin' });
    const maintain = app.runtime.lifecycle.maintainBook.bind(app.runtime.lifecycle);
    let protection = '',
      replacementId = '';
    const fault = vi
      .spyOn(app.runtime.lifecycle, 'maintainBook')
      .mockImplementationOnce(async (input) => {
        replacementId = input.plan.replacementId!;
        return maintain({
          ...input,
          plan: {
            ...input.plan,
            validate: async () => {
              const status = store.replacementStatus(replacementId);
              protection = path.join(
                app.runtime.dataDir,
                'core-protection',
                app.book.id,
                `${status.protectionId}.caiwu`,
              );
              renameSync(protection, protection + '.held');
              throw new Error('合成替换后验证与回滚存储双故障');
            },
          },
        });
      });
    try {
      await expect(api.reset.execute(execution(plan.planId))).rejects.toThrow('核对账套恢复状态');
      expect(store.replacementStatus(replacementId)).toMatchObject({
        status: 'failed',
        stagingRetained: true,
      });
      expect(() => cancelReset(app.runtime, session, plan.planId)).toThrow('隔离修复');
      expect(stagedFiles()).toHaveLength(1);
      expect(existsSync(protection + '.held')).toBe(true);
      expect(existsSync(store.pathOf(app.book.id) + '.quarantine.json')).toBe(true);
      await expect(app.login()).rejects.toThrow();
    } finally {
      fault.mockRestore();
      if (protection && existsSync(protection + '.held'))
        renameSync(protection + '.held', protection);
      if (replacementId)
        await store.recoverQuarantined({
          bookId: app.book.id,
          bookName: app.book.name,
          adminCode: 'admin',
          password: 'admin',
        });
    }
    expect((await app.core(await app.login()).auth.me()).book.name).toBe(app.book.name);
    expect(store.cancelReplacement({ bookId: app.book.id, replacementId })).toMatchObject({
      status: 'failed',
      stagingRetained: false,
    });
    expect(stagedFiles()).toHaveLength(0);
    expect(existsSync(protection)).toBe(true);
  });
  it('准备不写原账；执行保留账套ID、用户权限和审计，清空业务并重建制度、级次与期间；完整保护备份可回读', async () => {
    const clerk = await app.addUser('retained', {
      password: 'retained123',
      permissions: ['system-admin.password'],
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 13579 },
          { account: '6001', credit: 13579 },
        ],
      },
    ]);
    const users = await app.svc.db.selectFrom('app_user').selectAll().execute();
    const permissions = await app.svc.db.selectFrom('user_permission').selectAll().execute();
    const logs = await app.svc.log.list();
    const before = hash();
    const plan = await prepare();
    expect(hash()).toBe(before);
    const result = await app.call(server).reset.execute(execution(plan.planId));
    expect(result).toMatchObject({
      ok: true,
      relogin: true,
      bookId: app.book.id,
      protectionId: expect.any(String),
    });
    await expect(app.core(clerk).auth.me()).rejects.toThrow('登录已失效');
    const token = await app.login('retained', 'retained123');
    expect((await app.core(token).auth.me()).book).toMatchObject({
      id: app.book.id,
      name: parameters.name,
      orgName: parameters.orgName,
      startPeriod: 202706,
      codeScheme: [4, 3, 3],
    });
    const admin = await app.login();
    expect((await app.core(admin).vouchers.list({})).total).toBe(0);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    expect(raw.prepare('SELECT COUNT(*) AS n FROM opening_balance').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM dimension_item').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT * FROM app_user ORDER BY id').all()).toEqual(users);
    expect(raw.prepare('SELECT * FROM user_permission ORDER BY user_id, permission').all()).toEqual(
      permissions,
    );
    for (const log of logs)
      expect(raw.prepare('SELECT id FROM operation_log WHERE id=?').get(log.id)).toEqual({
        id: log.id,
      });
    expect(raw.prepare("SELECT code FROM account WHERE code='1002001'").get()).toEqual({
      code: '1002001',
    });
    expect((await app.core(admin).voucherPolicy.get()).numbering).toBe('manual');
    const protection = path.join(
      app.runtime.dataDir,
      'core-protection',
      app.book.id,
      `${result.protectionId}.caiwu`,
    );
    expect(existsSync(protection)).toBe(true);
    const backup = new Database(protection, { readonly: true });
    try {
      expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(backup.prepare('SELECT COUNT(*) AS n FROM voucher').get()).toEqual({ n: 1 });
      expect(backup.prepare('SELECT name FROM book_info').get()).toEqual({ name: app.book.name });
    } finally {
      backup.close();
    }
  });
  it('受管替换显式声明真实临时源ID，保留目标ID且准备不修改原账身份', async () => {
    const store = app.runtime.bookStore;
    const originalPrepare = store.prepareReplacement.bind(store);
    const before = hash();
    const staged = vi.spyOn(store, 'prepareReplacement').mockImplementation(async (input) => {
      const filename = path.join(app.runtime.dataDir, 'synthetic-source-identity.caiwu');
      writeFileSync(filename, input.bytes);
      const source = new Database(filename, { readonly: true, fileMustExist: true });
      try {
        const sourceInfo = source.prepare('SELECT book_id, name FROM book_info').get() as {
          book_id: string;
          name: string;
        };
        expect(input.bookId).toBe(app.book.id);
        expect(sourceInfo.book_id).not.toBe(input.bookId);
        expect(Reflect.get(input, 'sourceBookId')).toBe(sourceInfo.book_id);
        expect(sourceInfo.name).toBe(parameters.name);
      } finally {
        source.close();
        for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
      }
      return originalPrepare(input);
    });
    try {
      const plan = await prepare();
      expect(plan.bookId).toBe(app.book.id);
      expect(staged).toHaveBeenCalledOnce();
      expect(hash()).toBe(before);
      expect((await app.svc.book.info()).id).toBe(app.book.id);
    } finally {
      staged.mockRestore();
    }
  });
  it('口令、制度及级次错误不能准备，原账数据逐字节保留', async () => {
    const before = hash();
    await expect(app.call(server).reset.prepare({ parameters, password: 'wrong' })).rejects.toThrow(
      '管理员密码不正确',
    );
    await expect(
      app
        .call(server)
        .reset.prepare({ parameters: { ...parameters, templateId: 'missing' }, password: 'admin' }),
    ).rejects.toThrow('不存在');
    await expect(
      app
        .call(server)
        .reset.prepare({ parameters: { ...parameters, codeScheme: '4-0-2' }, password: 'admin' }),
    ).rejects.toThrow();
    expect(hash()).toBe(before);
  });
  it('预览后修改原账、换会话、错误目标名或口令均不执行', async () => {
    const plan = await prepare();
    const before = hash();
    await expect(
      app.call(server).reset.execute({ ...execution(plan.planId), confirmBookName: 'wrong' }),
    ).rejects.toThrow('名称');
    await expect(
      app.call(server).reset.execute({ ...execution(plan.planId), password: 'wrong' }),
    ).rejects.toThrow('管理员密码');
    expect(hash()).toBe(before);
    const other = await app.login();
    await expect(app.call(server, other).reset.execute(execution(plan.planId))).rejects.toThrow(
      '不属于当前登录',
    );
    await app.svc.settings.set('synthetic-change', 1);
    const changed = hash();
    await expect(app.call(server).reset.execute(execution(plan.planId))).rejects.toThrow(
      '发生变化',
    );
    expect(hash()).toBe(changed);
  });
  it('自动备份目录不可用时中止并保留原账，重新登录仍可查询原数据', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 120 },
          { account: '6001', credit: 120 },
        ],
      },
    ]);
    const plan = await prepare();
    const before = hash();
    const marker = path.join(app.runtime.dataDir, 'core-protection');
    writeFileSync(marker, '合成目录故障');
    await expect(app.call(server).reset.execute(execution(plan.planId))).rejects.toThrow();
    expect(hash()).toBe(before);
    const token = await app.login();
    expect((await app.core(token).vouchers.list({})).total).toBe(1);
    expect(readFileSync(marker, 'utf8')).toBe('合成目录故障');
  });
  it('替换后的校验失败自动回滚完整原账、保留保护备份并要求重新登录', async () => {
    const [voucher] = await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 9753 },
          { account: '6001', credit: 9753 },
        ],
      },
    ]);
    const before = await app.svc.vouchers.get(voucher!.id);
    const store = app.runtime.bookStore;
    const originalPrepare = store.prepareReplacement.bind(store);
    const staged = vi.spyOn(store, 'prepareReplacement').mockImplementation(async (input) => {
      // 序列化快照保留 WAL 文件头，写入独立临时文件后再修改，避免内存连接尝试打开 WAL。
      const directory = mkdtempSync(path.join(app.runtime.dataDir, 'reset-fault-'));
      const filename = path.join(directory, 'synthetic.caiwu');
      writeFileSync(filename, input.bytes);
      const corrupted = new Database(filename);
      let bytes: Buffer;
      try {
        corrupted.prepare('UPDATE book_info SET name=?').run('合成最终校验故障');
        bytes = corrupted.serialize();
      } finally {
        corrupted.close();
        rmSync(directory, { recursive: true, force: true });
      }
      return originalPrepare({
        ...input,
        bytes,
        length: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    });
    let plan: Awaited<ReturnType<typeof prepare>>;
    try {
      plan = await prepare();
    } finally {
      staged.mockRestore();
    }
    await expect(app.call(server).reset.execute(execution(plan.planId))).rejects.toThrow(
      '初始化结果验证未通过',
    );
    await expect(app.core().auth.me()).rejects.toThrow('登录已失效');
    const token = await app.login();
    expect((await app.core(token).auth.me()).book.name).toBe(app.book.name);
    expect(await app.core(token).vouchers.get({ id: voucher!.id })).toEqual(before);
    expect(existsSync(path.join(store.pathOf(app.book.id) + '.quarantine.json'))).toBe(false);
    const protectionDirectory = path.join(app.runtime.dataDir, 'core-protection', app.book.id);
    const protections = readdirSync(protectionDirectory).filter((file) => file.endsWith('.caiwu'));
    expect(protections).toHaveLength(1);
    const backup = new Database(path.join(protectionDirectory, protections[0]!), {
      readonly: true,
    });
    try {
      expect(backup.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(backup.prepare('SELECT COUNT(*) AS n FROM voucher').get()).toEqual({ n: 1 });
    } finally {
      backup.close();
    }
  });
  it('保存参数不保存密码也不执行；普通用户不可保存或准备', async () => {
    await app.call(server).reset.saveDraft(parameters);
    expect((await app.call(server).reset.preflight()).draft).toEqual(parameters);
    expect((await app.svc.book.info()).name).toBe(app.book.name);
    const token = await app.addUser('not-admin', { permissions: ['system-admin.reset'] });
    await expect(app.call(server, token).reset.saveDraft(parameters)).rejects.toThrow('管理员');
    await expect(
      app.call(server, token).reset.prepare({ parameters, password: 'admin' }),
    ).rejects.toThrow('管理员');
  });
});
