import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  openDatabase,
  runMigrations,
  withTransaction,
  type Kysely,
  type MigrationSet,
  type RawDatabase,
} from '@caiwu/db';
import { BusinessError } from '../errors';
import { parseCodeScheme, formatCodeScheme } from '../code-scheme';
import { DIMENSION_TYPES } from '../dimensions';
import { templateProblems } from '../template';
import { makePeriod } from '../period';
import {
  CreateBookInputSchema,
  type BookInfo,
  type BookSummary,
  type CreateBookInput,
} from '../book';
import type { ProductId } from '../products';
import type { CoreDB } from './schema';
import { coreMigrations } from './migrations';
import { emptyModuleLookup, type ModuleLookup, type ServiceContext } from './context';
import { createCoreServices } from './services';
import type { TemplateRegistry } from './templates';

/** 结算方式默认值（原版 jslb 表的常用项）。 */
const DEFAULT_SETTLEMENT_METHODS = [
  ['01', '现金'],
  ['02', '现金支票'],
  ['03', '转账支票'],
  ['04', '电汇'],
  ['05', '网银转账'],
  ['06', '银行汇票'],
  ['07', '银行承兑汇票'],
  ['08', '商业承兑汇票'],
  ['99', '其他'],
] as const;

export interface OpenBook {
  id: string;
  file: string;
  raw: RawDatabase;
  db: Kysely<CoreDB>;
}

export interface BookStoreOptions {
  /** 数据目录；账套文件放在 <dataDir>/books/<账套id>.caiwu */
  dataDir: string;
  /** 打开账套时要执行的迁移（core 在前）。用函数是为了让模块列表晚于 BookStore 创建也能生效。 */
  migrationSets: () => readonly MigrationSet[];
  templates: TemplateRegistry;
  modules?: ModuleLookup;
  now?: () => Date;
}

const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 账套文件的管理：列出、新建、打开（缓存连接并执行迁移）、关闭。
 * 一个账套 = 一个 SQLite 文件。复制、删除、备份恢复等文件操作由对应模块基于 pathOf()/close() 实现。
 */
export class BookStore {
  readonly booksDir: string;
  readonly #opts: BookStoreOptions;
  readonly #open = new Map<string, OpenBook>();

  constructor(opts: BookStoreOptions) {
    this.#opts = opts;
    this.booksDir = path.join(opts.dataDir, 'books');
    mkdirSync(this.booksDir, { recursive: true });
  }

  static isValidId(id: string): boolean {
    return BOOK_ID.test(id);
  }

  pathOf(id: string): string {
    if (!BookStore.isValidId(id))
      throw new BusinessError({ code: 'BOOK_ID_INVALID', message: '账套编号不合法' });
    return path.join(this.booksDir, `${id}.caiwu`);
  }

  exists(id: string): boolean {
    return BookStore.isValidId(id) && existsSync(this.pathOf(id));
  }

  /** 全部账套（按名称排序）。打不开的文件跳过。 */
  async list(): Promise<BookSummary[]> {
    const out: BookSummary[] = [];
    for (const name of readdirSync(this.booksDir)) {
      const m = /^(.+)\.caiwu$/.exec(name);
      if (!m || !BookStore.isValidId(m[1]!)) continue;
      const id = m[1]!;
      const file = path.join(this.booksDir, name);
      try {
        const raw =
          this.#open.get(id)?.raw ?? new Database(file, { readonly: true, fileMustExist: true });
        try {
          const row = raw.prepare('SELECT * FROM book_info WHERE id = 1').get() as
            CoreDB['book_info'] | undefined;
          const last = raw
            .prepare("SELECT value FROM book_setting WHERE scope = 'core' AND key = 'lastOpenedAt'")
            .get() as { value: string } | undefined;
          if (row) {
            out.push({
              ...toBookInfo(row),
              fileSize: statSync(file).size,
              lastOpenedAt: last ? (JSON.parse(last.value) as string) : null,
            });
          }
        } finally {
          if (!this.#open.has(id)) raw.close();
        }
      } catch {
        // 损坏或不是账套的文件：不出现在列表里
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** 打开账套（已打开则复用），并执行尚未执行的迁移。 */
  open(id: string): OpenBook {
    const cached = this.#open.get(id);
    if (cached) return cached;
    const file = this.pathOf(id);
    if (!existsSync(file))
      throw new BusinessError({ code: 'BOOK_NOT_FOUND', message: '账套不存在，可能已被删除' });
    const { raw, db } = openDatabase<CoreDB>(file);
    try {
      runMigrations(raw, this.#allMigrations());
    } catch (e) {
      raw.close();
      throw e;
    }
    const book = { id, file, raw, db };
    this.#open.set(id, book);
    return book;
  }

  async close(id: string): Promise<void> {
    const b = this.#open.get(id);
    if (!b) return;
    this.#open.delete(id);
    await b.db.destroy();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#open.keys()].map((id) => this.close(id)));
  }

  /** 新建账套：先写到临时文件，全部成功后再改名，避免留下半成品。 */
  async create(raw: CreateBookInput): Promise<BookInfo> {
    const input = CreateBookInputSchema.parse(raw);
    const template = this.#opts.templates.get(input.templateId);
    const scheme = parseCodeScheme(input.codeScheme ?? template.codeScheme);
    const problems = templateProblems(template, scheme);
    if (problems.length) {
      throw new BusinessError({
        code: 'TEMPLATE_SCHEME_MISMATCH',
        message: `「${template.name}」不能使用科目级次 ${formatCodeScheme(scheme)}：${problems[0]}`,
        hint: `这个模板默认的级次是 ${template.codeScheme}`,
        details: { problems },
      });
    }
    const id = randomUUID();
    const tmp = path.join(this.booksDir, `.${id}.creating`);
    const { raw: rawDb, db } = openDatabase<CoreDB>(tmp);
    try {
      runMigrations(rawDb, this.#allMigrations());
      const now = (this.#opts.now ?? (() => new Date()))();
      const nowText = now.toISOString();
      await withTransaction(db, async (trx) => {
        await trx
          .insertInto('book_info')
          .values({
            id: 1,
            book_id: id,
            name: input.name,
            org_name: input.orgName,
            template_id: template.id,
            template_version: template.version,
            template_name: template.name,
            regime: template.regime,
            product: input.product,
            start_period: makePeriod(input.startYear, input.startMonth),
            code_scheme: formatCodeScheme(scheme),
            base_currency: 'CNY',
            created_at: nowText,
            updated_at: nowText,
          })
          .execute();
        await trx
          .insertInto('dimension_type')
          .values(
            DIMENSION_TYPES.map((d, i) => ({
              id: d.id,
              name: d.name,
              column_name: d.column,
              sort: i,
            })),
          )
          .execute();
        await trx
          .insertInto('currency')
          .values([
            { code: 'CNY', name: '人民币', symbol: '¥', is_base: 1, disabled: 0, sort: 0 },
            ...template.currencies.map((c, i) => ({
              code: c.code,
              name: c.name,
              symbol: c.symbol ?? null,
              is_base: 0,
              disabled: 0,
              sort: i + 1,
            })),
          ])
          .execute();
        await trx
          .insertInto('account_category')
          .values(
            template.categories.map((c, i) => ({
              id: c.id,
              name: c.name,
              direction: c.direction,
              is_pnl: c.isPnl ? 1 : 0,
              sort: i,
            })),
          )
          .execute();
        await trx
          .insertInto('settlement_method')
          .values(
            DEFAULT_SETTLEMENT_METHODS.map(([code, name], i) => ({
              code,
              name,
              disabled: 0,
              sort: i,
            })),
          )
          .execute();
        await trx
          .insertInto('voucher_type')
          .values(
            template.voucherTypes.map((v, i) => ({
              code: v.code,
              name: v.name,
              rule: null,
              disabled: 0,
              sort: i,
            })),
          )
          .execute();

        const bootstrapUser = {
          id: 0,
          code: 'system',
          name: '系统',
          isAdmin: true,
          permissions: new Set<string>(),
        };
        const ctx: ServiceContext = {
          db: trx,
          user: bootstrapUser,
          moduleId: null,
          now: () => now,
          modules: this.#opts.modules ?? emptyModuleLookup,
        };
        const boot = createCoreServices(ctx);
        await boot.periods.ensureYear(input.startYear, {
          fromMonth: input.startMonth,
          openingStored: true,
        });
        const admin = await boot.users.create({
          code: input.adminCode,
          name: input.adminName,
          password: input.adminPassword,
          isAdmin: true,
        });
        const svc = createCoreServices({ ...ctx, user: admin });
        const ordered = [...template.accounts].sort(
          (a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code),
        );
        for (const a of ordered) {
          await svc.accounts.create(
            {
              code: a.code,
              name: a.name,
              categoryId: a.category,
              direction: a.direction,
              isCash: a.cash,
              isBank: a.bank,
              cashflowRequired: a.cashflow,
              isPartner: a.partner,
              currency: a.currency ?? null,
              quantityUnit: a.quantityUnit ?? null,
              disabled: a.disabled,
              dimensions: a.dimensions,
            },
            scheme,
          );
        }
        await svc.log.write({
          action: 'book.create',
          summary: `新建账套「${input.name}」（${template.name}，科目级次 ${formatCodeScheme(scheme)}）`,
        });
      });
      await db.destroy();
      renameSync(tmp, this.pathOf(id));
    } catch (e) {
      await db.destroy().catch(() => {});
      for (const suffix of ['', '-wal', '-shm']) rmSync(tmp + suffix, { force: true });
      throw e;
    }
    const opened = this.open(id);
    return createCoreServices({
      db: opened.db,
      user: { id: 0, code: 'system', name: '系统', isAdmin: true, permissions: new Set() },
      moduleId: null,
      now: () => new Date(),
      modules: emptyModuleLookup,
    }).book.info();
  }

  #allMigrations(): MigrationSet[] {
    return [
      { scope: 'core', migrations: coreMigrations },
      ...this.#opts.migrationSets().filter((s) => s.scope !== 'core'),
    ];
  }
}

function toBookInfo(row: CoreDB['book_info']): BookInfo {
  return {
    id: row.book_id,
    name: row.name,
    orgName: row.org_name,
    templateId: row.template_id,
    templateName: row.template_name,
    regime: row.regime,
    product: row.product as ProductId,
    startPeriod: row.start_period,
    codeScheme: parseCodeScheme(row.code_scheme),
    baseCurrency: row.base_currency,
    createdAt: row.created_at,
  };
}
