import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MigrationSet } from '@caiwu/db';
import {
  BookStore,
  DEMO_DIMENSIONS,
  TemplateRegistry,
  builtinTemplates,
  seedDemoData,
  createCoreServices,
  emptyModuleLookup,
  loadServiceUser,
  type CoreServices,
  type ModuleLookup,
  type OpenBook,
  type ServiceUser,
} from '@caiwu/core/server';
import type { BookInfo, ProductId } from '@caiwu/core';

export interface TestBookOptions {
  startYear?: number;
  startMonth?: number;
  product?: ProductId;
  templateId?: string;
  codeScheme?: string;
  /** 额外的迁移（模块的表） */
  migrationSets?: MigrationSet[];
  /** 额外的会计制度模板 */
  templates?: unknown[];
  modules?: ModuleLookup;
  /** 是否预置辅助档案、汇率（默认 true） */
  seed?: boolean;
  now?: () => Date;
}

export interface TestBook {
  dataDir: string;
  store: BookStore;
  templates: TemplateRegistry;
  info: BookInfo;
  book: OpenBook;
  /** 管理员身份的核心服务（moduleId = null，相当于手工操作） */
  svc: CoreServices;
  /** 以某个模块的身份调用核心服务（生成的凭证会记为该模块的来源） */
  forModule(moduleId: string, user?: ServiceUser): CoreServices;
  /** 以某个操作员身份调用核心服务 */
  as(userCode: string, moduleId?: string | null): Promise<CoreServices>;
  /** 新建一个操作员（默认非管理员、无权限）并返回其身份的服务 */
  addUser(
    code: string,
    opts?: { name?: string; permissions?: string[]; isAdmin?: boolean; password?: string },
  ): Promise<CoreServices>;
  close(): Promise<void>;
}

/**
 * 建一个临时测试账套（默认 2026 年 1 月启用、演示科目表、成本会计形态），
 * 并预置常用辅助档案。测试结束调用 close() 删除临时目录。
 */
export async function createTestBook(opts: TestBookOptions = {}): Promise<TestBook> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-test-'));
  const templates = new TemplateRegistry({ devMode: true });
  templates.register('core', builtinTemplates);
  if (opts.templates?.length) templates.register('test', opts.templates);
  const modules = opts.modules ?? emptyModuleLookup;
  const store = new BookStore({
    dataDir,
    templates,
    modules,
    migrationSets: () => opts.migrationSets ?? [],
    now: opts.now,
  });
  const info = await store.create({
    name: '测试账套',
    orgName: '测试单位有限公司',
    templateId: opts.templateId ?? 'demo-enterprise',
    product: opts.product ?? 'chengben',
    startYear: opts.startYear ?? 2026,
    startMonth: opts.startMonth ?? 1,
    codeScheme: opts.codeScheme,
    adminPassword: 'admin',
  });
  const book = store.open(info.id);
  const admin = (await loadServiceUser(book.db, 1))!;
  const make = (user: ServiceUser, moduleId: string | null) =>
    createCoreServices({
      db: book.db,
      user,
      moduleId,
      now: opts.now ?? (() => new Date()),
      modules,
    });
  const svc = make(admin, null);
  if (opts.seed !== false) await seedReferenceData(svc, info.startPeriod);

  return {
    dataDir,
    store,
    templates,
    info,
    book,
    svc,
    forModule: (moduleId, user = admin) => make(user, moduleId),
    async as(userCode, moduleId = null) {
      const row = await book.db
        .selectFrom('app_user')
        .select('id')
        .where('code', '=', userCode)
        .executeTakeFirst();
      if (!row) throw new Error(`测试账套里没有用户 ${userCode}`);
      return make((await loadServiceUser(book.db, row.id))!, moduleId);
    },
    async addUser(code, o = {}) {
      const user = await svc.users.create({
        code,
        name: o.name ?? code,
        password: o.password ?? '',
        isAdmin: o.isAdmin ?? false,
        permissions: o.permissions ?? [],
      });
      return make(user, null);
    },
    async close() {
      await store.closeAll();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** 预置的辅助档案编码（与 core 的演示数据相同），测试里可以直接用。 */
export const SEED_DIMENSIONS = DEMO_DIMENSIONS;

/** 预置辅助档案、汇率、摘要（createTestBook / createTestApp 默认调用）。 */
export const seedReferenceData = seedDemoData;
