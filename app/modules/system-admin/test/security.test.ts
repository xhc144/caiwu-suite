import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TRPCError } from '@trpc/server';
import { defineManifest, type BusinessError } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';

const temporaryManifest = defineManifest({
  id: 'temporary-test',
  name: '临时测试模块',
  products: 'all',
  permissions: [{ id: 'temporary-test.read', name: '临时读取' }],
  menu: [],
});
const temporaryKit = moduleKit(temporaryManifest);
const temporaryModule = defineServerModule(temporaryManifest, {
  router: temporaryKit.router({
    read: temporaryKit.procedure
      .meta({ permission: 'temporary-test.read' })
      .query(() => ({ ok: true })),
  }),
});
let app: TestApp;
const api = () => app.call(server);
async function error(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(e).not.toBeNull();
  return ((e as TRPCError).cause as BusinessError).data;
}
async function create(code = 'clerk', permissions: string[] = [], isAdmin = false) {
  const result = await api().users.create({
    code,
    name: `用户 ${code}`,
    password: 'password123',
    confirmPassword: 'password123',
    permissions,
    isAdmin,
  });
  return { ...result, token: await app.login(code, 'password123') };
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server, temporaryModule] });
});
afterEach(async () => {
  await app.close();
});

describe('w_xt_users / w_xt_uses_zj / w_grant 安全不变量', () => {
  it('w_xt_uses_zj 编号格式、重复编号、空姓名和密码确认均阻止', async () => {
    await create();
    expect(
      (
        await error(
          api().users.create({
            code: 'clerk',
            name: '重复',
            password: 'password123',
            confirmPassword: 'password123',
          }),
        )
      ).code,
    ).toBe('USER_CODE_EXISTS');
    for (const code of ['', '中文', 'a'.repeat(21), 'a b'])
      await expect(
        api().users.create({
          code,
          name: 'x',
          password: 'password123',
          confirmPassword: 'password123',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api().users.create({
        code: 'new',
        name: ' ',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api().users.create({
        code: 'new',
        name: 'x',
        password: 'password123',
        confirmPassword: 'different',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await create('a._-1');
  });
  it('w_users 修改名称不修改编号；用户列表没有密码哈希', async () => {
    const u = await create();
    await api().users.update({ id: u.id, name: '新名称', disabled: false, confirmCode: u.code });
    expect((await api().users.list()).find((x) => x.id === u.id)).toEqual({
      id: u.id,
      code: u.code,
      name: '新名称',
      disabled: false,
      isAdmin: false,
    });
    expect(JSON.stringify(await api().users.list())).not.toMatch(/hash|scrypt|password|token/i);
    expect(app.runtime.sessions.get(u.token)).toBeNull();
  });
  it('w_xt_users 不能停用自己；不能降权最后一个启用管理员，用户名不是判据', async () => {
    expect(
      (
        await error(
          api().users.update({ id: 1, name: '管理员', disabled: true, confirmCode: 'admin' }),
        )
      ).code,
    ).toBe('SELF_DISABLE');
    expect(
      (
        await error(
          api().users.setPermissions({
            id: 1,
            isAdmin: false,
            permissions: [],
            confirmCode: 'admin',
          }),
        )
      ).code,
    ).toBe('LAST_ADMIN');
    const named = await create('MANAGER');
    await api().users.update({
      id: named.id,
      name: '普通用户',
      disabled: true,
      confirmCode: 'MANAGER',
    });
    expect((await api().users.list()).find((x) => x.id === named.id)?.disabled).toBe(true);
  });
  it('w_xt_users 目标确认不符时不修改；停用保留用户和历史引用并失效全部旧会话', async () => {
    const u = await create();
    const token2 = await app.login(u.code, 'password123');
    expect(
      (
        await error(
          api().users.update({ id: u.id, name: 'x', disabled: true, confirmCode: 'wrong' }),
        )
      ).code,
    ).toBe('CONFIRM_REQUIRED');
    expect(app.runtime.sessions.get(u.token)).not.toBeNull();
    await api().users.update({ id: u.id, name: '停用用户', disabled: true, confirmCode: u.code });
    expect(app.runtime.sessions.get(u.token)).toBeNull();
    expect(app.runtime.sessions.get(token2)).toBeNull();
    expect((await api().users.list()).find((x) => x.id === u.id)?.disabled).toBe(true);
    expect(
      (
        await error(
          app
            .core(null)
            .auth.login({ bookId: app.book.id, userCode: u.code, password: 'password123' }),
        )
      ).code,
    ).toBe('LOGIN_FAILED');
  });
  it('w_xt_users 并发管理员降权在事务内复核，始终保留一个启用管理员', async () => {
    const second = await create('second', [], true);
    const results = await Promise.allSettled([
      api().users.setPermissions({ id: 1, isAdmin: false, permissions: [], confirmCode: 'admin' }),
      app.call(server, second.token).users.setPermissions({
        id: second.id,
        isAdmin: false,
        permissions: [],
        confirmCode: second.code,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await app.svc.users.list()).filter((u) => u.isAdmin && !u.disabled)).toHaveLength(1);
  });
  it('w_grant 临时模块真实登记到权限树，授予/撤销后直接调用权限立即改变', async () => {
    const u = await create();
    const manifests = await app.core().modules.list();
    expect(manifests.find((m) => m.id === 'temporary-test')?.permissions).toContainEqual({
      id: 'temporary-test.read',
      name: '临时读取',
    });
    expect((await error(app.call(temporaryModule, u.token).read())).code).toBe('FORBIDDEN');
    await api().users.setPermissions({
      id: u.id,
      isAdmin: false,
      permissions: ['temporary-test.read'],
      confirmCode: u.code,
    });
    expect(app.runtime.sessions.get(u.token)).toBeNull();
    const next = await app.login(u.code, 'password123');
    expect(await app.call(temporaryModule, next).read()).toEqual({ ok: true });
    await api().users.setPermissions({
      id: u.id,
      isAdmin: false,
      permissions: [],
      confirmCode: u.code,
    });
    expect((await error(app.call(temporaryModule, next).read())).code).toBe('UNAUTHORIZED');
    expect(
      (await error(app.call(temporaryModule, await app.login(u.code, 'password123')).read())).code,
    ).toBe('FORBIDDEN');
  });
  it('w_xt_users_qx 拒绝未知权限且保留未加载模块历史权限，清空仅影响当前已加载功能', async () => {
    const u = await create();
    await app.svc.users.setPermissions(u.id, ['old-module.history', 'temporary-test.read']);
    expect(
      (
        await error(
          api().users.setPermissions({
            id: u.id,
            isAdmin: false,
            permissions: ['fake.permission'],
            confirmCode: u.code,
          }),
        )
      ).code,
    ).toBe('UNKNOWN_PERMISSION');
    expect((await api().users.permissions({ id: u.id })).preservedPermissions).toEqual([
      'old-module.history',
    ]);
    await api().users.setPermissions({
      id: u.id,
      isAdmin: false,
      permissions: [],
      confirmCode: u.code,
    });
    expect(await api().users.permissions({ id: u.id })).toMatchObject({
      permissions: [],
      preservedPermissions: ['old-module.history'],
    });
    expect(
      (
        await error(
          api().users.create({
            code: 'fake',
            name: 'x',
            password: 'password123',
            confirmPassword: 'password123',
            permissions: ['fake.permission'],
          }),
        )
      ).code,
    ).toBe('UNKNOWN_PERMISSION');
  });
  it('w_main1 / w_grant 非管理员即使得到管理功能点也不能列用户、读取权限或提权', async () => {
    const u = await create('delegated', [
      'system-admin.users.manage',
      'system-admin.permissions.manage',
      'system-admin.password.reset',
    ]);
    const delegated = app.call(server, u.token);
    expect((await error(delegated.users.list())).code).toBe('FORBIDDEN');
    expect((await error(delegated.users.permissions({ id: 1 }))).code).toBe('FORBIDDEN');
    expect(
      (
        await error(
          delegated.users.setPermissions({
            id: u.id,
            isAdmin: true,
            permissions: ['temporary-test.read'],
            confirmCode: u.code,
          }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await error(
          delegated.users.create({
            code: 'attacker',
            name: 'x',
            isAdmin: true,
            password: 'password123',
            confirmPassword: 'password123',
          }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await error(
          delegated.users.resetPassword({
            id: 1,
            confirmCode: 'admin',
            password: 'password123',
            confirmPassword: 'password123',
          }),
        )
      ).code,
    ).toBe('FORBIDDEN');
  });
  it('w_xt_users 无查看权限不能读取管理接口', async () => {
    const u = await create();
    expect((await error(app.call(server, u.token).users.list())).code).toBe('FORBIDDEN');
    expect((await error(app.call(server, u.token).users.permissions({ id: 1 }))).code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('w_pass / w_login / w_login_1', () => {
  it('w_pass 事务内日志写入失败时改密回滚且旧会话保留', async () => {
    const u = await create('rollback', ['system-admin.password']);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TEMP TRIGGER system_admin_test_log_failure BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, '合成日志失败'); END",
    );
    try {
      await expect(
        app.call(server, u.token).changePassword({
          oldPassword: 'password123',
          password: 'changed123',
          confirmPassword: 'changed123',
        }),
      ).rejects.toThrow();
      expect(app.runtime.sessions.get(u.token)).not.toBeNull();
    } finally {
      raw.exec('DROP TRIGGER system_admin_test_log_failure');
    }
    expect(await app.login(u.code, 'password123')).toBeTruthy();
    expect(
      (
        await error(
          app
            .core(null)
            .auth.login({ bookId: app.book.id, userCode: u.code, password: 'changed123' }),
        )
      ).code,
    ).toBe('LOGIN_FAILED');
  });

  it('w_pass 错误旧密码及新密码不一致不修改密码、不失效会话', async () => {
    const u = await create('clerk', ['system-admin.password']);
    const clerk = app.call(server, u.token);
    expect(
      (
        await error(
          clerk.changePassword({
            oldPassword: 'wrong',
            password: 'newpassword',
            confirmPassword: 'newpassword',
          }),
        )
      ).code,
    ).toBe('OLD_PASSWORD_INVALID');
    await expect(
      clerk.changePassword({
        oldPassword: 'password123',
        password: 'newpassword',
        confirmPassword: 'different',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const password of ['1234567', 'a'.repeat(65)])
      await expect(
        clerk.changePassword({ oldPassword: 'password123', password, confirmPassword: password }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(app.runtime.sessions.get(u.token)).not.toBeNull();
    expect(await app.login(u.code, 'password123')).toBeTruthy();
  });
  it('w_pass 成功改密使本账套所有旧 token 失效，新密码可登录且日志无秘密', async () => {
    const u = await create('clerk', ['system-admin.password']);
    const token2 = await app.login(u.code, 'password123');
    await app.call(server, u.token).changePassword({
      oldPassword: 'password123',
      password: 'newpassword',
      confirmPassword: 'newpassword',
    });
    for (const token of [u.token, token2])
      expect((await error(app.core(token).auth.me())).code).toBe('UNAUTHORIZED');
    expect(await app.login(u.code, 'newpassword')).toBeTruthy();
    expect(
      (
        await error(
          app
            .core(null)
            .auth.login({ bookId: app.book.id, userCode: u.code, password: 'password123' }),
        )
      ).code,
    ).toBe('LOGIN_FAILED');
    const logs = JSON.stringify(await app.svc.log.list());
    expect(logs).not.toContain('newpassword');
    expect(logs).not.toContain('password123');
    expect(logs).not.toContain(u.token);
    expect(logs).not.toContain('scrypt$');
  });
  it('w_xt_users 重置密码需目标确认、不允许空密码；成功失效旧会话', async () => {
    const u = await create();
    expect(
      (
        await error(
          api().users.resetPassword({
            id: u.id,
            confirmCode: 'wrong',
            password: 'newpassword',
            confirmPassword: 'newpassword',
          }),
        )
      ).code,
    ).toBe('CONFIRM_REQUIRED');
    await expect(
      api().users.resetPassword({
        id: u.id,
        confirmCode: u.code,
        password: '',
        confirmPassword: '',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await api().users.resetPassword({
      id: u.id,
      confirmCode: u.code,
      password: 'newpassword',
      confirmPassword: 'newpassword',
    });
    expect(app.runtime.sessions.get(u.token)).toBeNull();
    expect(await app.login(u.code, 'newpassword')).toBeTruthy();
  });
  it('w_pass / w_xt_users 相同用户 ID 在另一账套的会话与密码不受改密、停用影响', async () => {
    const b = await app.core(null).books.create({
      name: '第二账套',
      orgName: '第二单位',
      templateId: 'demo-enterprise',
      product: 'qingsong',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'other-book',
    });
    const other = await app
      .core(null)
      .auth.login({ bookId: b.id, userCode: 'admin', password: 'other-book' });
    await api().changePassword({
      oldPassword: 'admin',
      password: 'admin-new',
      confirmPassword: 'admin-new',
    });
    expect(app.runtime.sessions.get(other.token)).not.toBeNull();
    expect((await app.core(other.token).auth.me()).book.id).toBe(b.id);
    const current = await app.login('admin', 'admin-new');
    const second = await app.call(server, current).users.create({
      code: 'second',
      name: '管理员二',
      isAdmin: true,
      password: 'password123',
      confirmPassword: 'password123',
    });
    const token2 = await app.login('second', 'password123');
    await app
      .call(server, token2)
      .users.update({ id: 1, name: '已停用管理员', disabled: true, confirmCode: 'admin' });
    expect(second.id).toBe(2);
    expect((await app.core(other.token).auth.me()).user.id).toBe(1);
    expect(
      (await app.core(null).auth.login({ bookId: b.id, userCode: 'admin', password: 'other-book' }))
        .token,
    ).toBeTruthy();
  });
  it('w_login 错账号、错密码、停用统一失败；缺失账套与无效会话可读', async () => {
    const u = await create();
    await api().users.update({ id: u.id, name: '停用', disabled: true, confirmCode: u.code });
    const messages = [];
    for (const [userCode, password] of [
      ['missing', 'wrong'],
      ['admin', 'wrong'],
      [u.code, 'password123'],
    ])
      messages.push(
        (
          await error(
            app
              .core(null)
              .auth.login({ bookId: app.book.id, userCode: userCode!, password: password! }),
          )
        ).message,
      );
    expect(new Set(messages).size).toBe(1);
    expect(
      (await error(app.core(null).auth.login({ bookId: '', userCode: 'admin', password: 'admin' })))
        .code,
    ).toBe('BOOK_NOT_FOUND');
    expect((await error(app.core('expired-token').auth.me())).code).toBe('UNAUTHORIZED');
  });
  it('w_login_1 未确认不能切换；确认后只撤销当前会话', async () => {
    const u = await create('clerk', ['system-admin.view']);
    const second = await app.login(u.code, 'password123');
    await expect(
      app.call(server, u.token).switchUser({ confirmed: false as true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(app.runtime.sessions.get(u.token)).not.toBeNull();
    await app.call(server, u.token).switchUser({ confirmed: true });
    expect(app.runtime.sessions.get(u.token)).toBeNull();
    expect(app.runtime.sessions.get(second)).not.toBeNull();
  });
});
