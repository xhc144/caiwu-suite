import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AnyTRPCRouter } from '@trpc/server';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import type { BookInfo, ProductId } from '@caiwu/core';
import {
  buildAppRouter,
  coreRouter,
  createRuntime,
  t,
  type AppRuntime,
  type ServerModule,
} from '@caiwu/server-kit';
import { seedReferenceData } from './book';

export interface TestAppOptions {
  modules?: ServerModule[];
  product?: ProductId;
  startYear?: number;
  startMonth?: number;
  templateId?: string;
  seed?: boolean;
}

export interface TestApp {
  runtime: AppRuntime;
  router: AnyTRPCRouter;
  book: BookInfo;
  /** 管理员身份的核心服务（直接造数据用） */
  svc: CoreServices;
  /** 某个模块身份的核心服务 */
  svcFor(moduleId: string): CoreServices;
  /** 登录，返回令牌 */
  login(userCode?: string, password?: string): Promise<string>;
  /** core.* 接口的调用器（默认管理员登录） */
  core(token?: string | null): ReturnType<typeof coreCaller>;
  /** 某个模块接口（m.<id>.*）的调用器，类型来自模块自己的 router */
  call<R extends AnyTRPCRouter>(mod: ServerModule<R>, token?: string | null): ModuleCaller<R>;
  /** 新建操作员（默认无权限），返回其登录令牌 */
  addUser(
    code: string,
    opts?: { permissions?: string[]; isAdmin?: boolean; password?: string },
  ): Promise<string>;
  close(): Promise<void>;
}

/** 直接对模块 router 建调用器；ctx 和真实服务完全一样（登录、权限、模块身份）。 */
function makeModuleCaller<R extends AnyTRPCRouter>(
  runtime: AppRuntime,
  mod: ServerModule<R>,
  token: string | null,
) {
  return t.createCallerFactory<R['_def']['record']>(mod.router)({ app: runtime, token });
}
type ModuleCaller<R extends AnyTRPCRouter> = ReturnType<typeof makeModuleCaller<R>>;

function coreCaller(runtime: AppRuntime, token: string | null) {
  return t.createCallerFactory(t.router({ core: coreRouter }))({ app: runtime, token }).core;
}

/**
 * 带服务端的测试环境：真实的模块登记、迁移、登录会话和权限检查，
 * 通过 tRPC caller 调接口（不起 HTTP）。默认建好一个演示账套并以 admin/admin 登录。
 *
 *   const app = await createTestApp({ modules: [exampleServer] });
 *   const api = app.call(exampleServer);
 *   await api.memos.create({...});
 */
export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-app-'));
  const runtime = createRuntime({ dataDir, modules: opts.modules ?? [], devMode: true });
  const router = buildAppRouter(runtime);
  const book = await runtime.bookStore.create({
    name: '测试账套',
    orgName: '测试单位有限公司',
    templateId: opts.templateId ?? 'demo-enterprise',
    product: opts.product ?? 'chengben',
    startYear: opts.startYear ?? 2026,
    startMonth: opts.startMonth ?? 1,
    adminPassword: 'admin',
  });
  const opened = runtime.bookStore.open(book.id);
  const admin = (await loadServiceUser(opened.db, 1))!;
  const make = (moduleId: string | null) =>
    createCoreServices({
      db: opened.db,
      user: admin,
      moduleId,
      now: runtime.now,
      modules: runtime.modules.lookup,
    });
  const svc = make(null);
  if (opts.seed !== false) await seedReferenceData(svc, book.startPeriod);

  const login = async (userCode = 'admin', password = 'admin') =>
    (await coreCaller(runtime, null).auth.login({ bookId: book.id, userCode, password })).token;
  const adminToken = await login();

  return {
    runtime,
    router,
    book,
    svc,
    svcFor: make,
    login,
    core: (token = adminToken) => coreCaller(runtime, token),
    call<R extends AnyTRPCRouter>(mod: ServerModule<R>, token: string | null = adminToken) {
      return makeModuleCaller(runtime, mod, token);
    },
    async addUser(code, o = {}) {
      await svc.users.create({
        code,
        name: code,
        password: o.password ?? '',
        isAdmin: o.isAdmin,
        permissions: o.permissions,
      });
      return login(code, o.password ?? '');
    },
    async close() {
      await runtime.bookStore.closeAll();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
