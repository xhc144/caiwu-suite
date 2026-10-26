import Database from 'better-sqlite3';
import { DataDirectoryLease } from './data-directory-lease';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  openDatabase,
  databaseFile,
  closeDatabaseFile,
  assertDatabaseFileQuiescent,
  UnmanagedSqliteTransactionError,
  isInDatabaseTransaction,
  ResourceGate,
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
  /** 只允许一个 server；辅助 runtime 与它共享进程占用，但不能释放 server 的占用。 */
  exclusiveServer?: boolean;
  /** 打开账套时要执行的迁移（core 在前）。用函数是为了让模块列表晚于 BookStore 创建也能生效。 */
  migrationSets: () => readonly MigrationSet[];
  templates: TemplateRegistry;
  modules?: ModuleLookup;
  now?: () => Date;
  maintenanceStarted?: (bookId: string) => void;
  beforeClose?: (
    book: OpenBook,
    signal: AbortSignal,
    reason: 'close' | 'maintenance' | 'shutdown',
  ) => Promise<void>;
}

/** 破坏性计划仅冻结接口，当前总是拒绝；回调只支持备份、检查和重连，不得改动账套文件。 */
export interface BookMaintenancePlan<T = void> {
  kind: 'reconnect' | 'delete' | 'replace';
  timeoutMs?: number;
  prepare?: (book: OpenBook, signal: AbortSignal) => Promise<T>;
  validate?: (book: OpenBook, signal: AbortSignal) => Promise<void>;
  onQuiesced?: () => Promise<void>;
}

const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type DirectoryState = { operations: ResourceGate; stores: Set<BookStore> };
const directories = new Map<string, DirectoryState>();

/**
 * 账套文件的管理：列出、新建、打开（缓存连接并执行迁移）、关闭。
 * 一个账套 = 一个 SQLite 文件。close/pathOf 不授权移动文件；删除、覆盖当前仍不支持。
 */
export class BookStore {
  readonly booksDir: string;
  readonly #opts: BookStoreOptions;
  readonly #open = new Map<string, OpenBook>();
  readonly #operations: ResourceGate;
  readonly #directory: DirectoryState;
  readonly #closing = new Map<string, Promise<void>>();
  #lease: DataDirectoryLease | null;
  #closingAll: Promise<void> | null = null;
  #disposed = false;
  #disposeAfterClose = false;
  readonly #known = new Set<string>();

  constructor(opts: BookStoreOptions) {
    this.#opts = opts;
    this.#lease = new DataDirectoryLease(opts.dataDir, { server: opts.exclusiveServer });
    this.#directory = directories.get(this.#lease.directory) ?? {
      operations: new ResourceGate(maintenanceError),
      stores: new Set(),
    };
    directories.set(this.#lease.directory, this.#directory);
    this.#operations = this.#directory.operations;
    this.booksDir = path.join(this.#lease.directory, 'books');
    try {
      mkdirSync(this.booksDir, { recursive: true });
      if (lstatSync(this.booksDir).isSymbolicLink()) throw new Error('账套目录不支持符号链接');
    } catch (error) {
      this.#lease.release();
      throw error;
    }
    this.#directory.stores.add(this);
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
    this.#ensureLease();
    return this.#operations.run(() => this.#list());
  }

  async #list(): Promise<BookSummary[]> {
    const out: BookSummary[] = [];
    for (const name of readdirSync(this.booksDir)) {
      const m = /^(.+)\.caiwu$/.exec(name);
      if (!m || !BookStore.isValidId(m[1]!)) continue;
      const id = m[1]!;
      const file = path.join(this.booksDir, name);
      try {
        if (lstatSync(file).isSymbolicLink()) continue;
        this.#gate(id).assertAvailable();
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
    this.#ensureLease();
    this.#operations.assertAvailable();
    this.#gate(id).retainForRequest();
    this.#gate(id).assertAvailable();
    if (this.#closing.has(id) || databaseFile(this.pathOf(id)).closing)
      throw maintenanceError('busy');
    const cached = this.#open.get(id);
    if (cached?.raw.open) return cached;
    this.#open.delete(id);
    const file = this.pathOf(id);
    if (!existsSync(file))
      throw new BusinessError({ code: 'BOOK_NOT_FOUND', message: '账套不存在，可能已被删除' });
    if (lstatSync(file).isSymbolicLink() || lstatSync(file).nlink !== 1)
      throw new BusinessError({
        code: 'BOOK_LINK_UNSUPPORTED',
        message: '账套文件不支持符号链接或硬链接',
      });
    const connection = openDatabase<CoreDB>(file);
    const { raw, db } = connection;
    try {
      runMigrations(raw, this.#allMigrations());
    } catch (e) {
      void connection.close().catch(() => this.#gate(id).block());
      throw e;
    }
    const book = { id, file, raw, db };
    this.#open.set(id, book);
    return book;
  }

  /** 请求/后台任务的租约。取得连接和所有 await 必须在回调内。 */
  async withBook<T>(id: string, fn: (book: OpenBook) => Promise<T>): Promise<T> {
    return this.#operations.runFresh(() => {
      this.#ensureLease();
      return this.#gate(id).runFresh(() => fn(this.open(id)));
    });
  }

  /** 仅重连已支持；delete/replace 在任何 callback 和会话变更前拒绝。 */
  maintain<T>(id: string, plan: BookMaintenancePlan<T>): Promise<T | undefined> {
    if (isInDatabaseTransaction()) return Promise.reject(new Error('事务回调内不能启动账套维护'));
    if (plan.kind !== 'reconnect')
      return Promise.reject(
        new BusinessError({
          code: 'DESTRUCTIVE_MAINTENANCE_UNAVAILABLE',
          message: '暂不支持删除或覆盖账套，无法排除未知外部 SQLite 连接',
          hint: '请保留原账套，恢复时使用新副本',
        }),
      );
    this.#ensureLease();
    return this.#operations.run(() =>
      this.#gate(id).exclusive(
        (signal) =>
          this.#operations.runFresh(async () => {
            const end = this.#lease!.beginMaintenance();
            try {
              this.#assertConnectionsQuiescent(id);
              await plan.onQuiesced?.();
              signal.throwIfAborted();
              for (const store of this.#directory.stores) store.#opts.maintenanceStarted?.(id);
              let book = this.open(id);
              await this.#beforeClose(id, signal, 'maintenance');
              signal.throwIfAborted();
              const result = await plan.prepare?.(book, signal);
              signal.throwIfAborted();
              await this.#closeConnections(id);
              // 即使此时超时也先恢复原连接；从未移动主文件或 WAL。
              book = this.open(id);
              signal.throwIfAborted();
              await plan.validate?.(book, signal);
              signal.throwIfAborted();
              return result;
            } finally {
              end();
            }
          }),
        plan.timeoutMs,
      ),
    );
  }

  close(id: string): Promise<void> {
    if (isInDatabaseTransaction()) return Promise.reject(new Error('事务回调内不能关闭账套'));
    const pending = this.#closing.get(id);
    if (pending) return pending;
    this.#ensureLease();
    return this.#operations.run(() =>
      this.#gate(id).exclusive(async (signal) => {
        const end = this.#lease!.isAuxiliary ? () => {} : this.#lease!.beginMaintenance();
        try {
          this.#assertConnectionsQuiescent(id);
          await this.#beforeClose(id, signal, 'close');
          signal.throwIfAborted();
          await this.#closeConnections(id);
        } finally {
          end();
        }
      }),
    );
  }

  async #closeConnections(id: string): Promise<void> {
    const pending = closeDatabaseFile(this.pathOf(id));
    this.#closing.set(id, pending);
    try {
      await pending;
      for (const store of this.#directory.stores) store.#open.delete(id);
    } catch (error) {
      throw bookCloseError(error);
    } finally {
      this.#closing.delete(id);
    }
  }

  #assertConnectionsQuiescent(id: string): void {
    try {
      assertDatabaseFileQuiescent(this.pathOf(id));
    } catch (error) {
      throw bookCloseError(error);
    }
  }

  async #beforeClose(
    id: string,
    signal: AbortSignal,
    reason: 'close' | 'maintenance' | 'shutdown',
  ): Promise<void> {
    for (const store of this.#directory.stores) {
      const book = store.#open.get(id);
      if (book) await store.#opts.beforeClose?.(book, signal, reason);
      signal.throwIfAborted();
    }
  }

  /** 缓存清理保持兼容；server 的目录占用直到 dispose 才释放。 */
  closeAll(): Promise<void> {
    if (isInDatabaseTransaction()) return Promise.reject(new Error('事务回调内不能关闭账套'));
    if (this.#closingAll) return this.#closingAll;
    if (!this.#lease) return Promise.resolve();
    this.#lease.assertOwned();
    this.#closingAll = this.#operations
      .exclusive(async () => {
        const end = this.#lease!.isAuxiliary ? () => {} : this.#lease!.beginMaintenance();
        try {
          const ids = new Set([
            ...[...this.#directory.stores].flatMap((store) => [
              ...store.#known,
              ...store.#open.keys(),
            ]),
            ...readdirSync(this.booksDir)
              .filter((name) => name.endsWith('.caiwu'))
              .map((name) => name.slice(0, -6))
              .filter(BookStore.isValidId),
          ]);
          for (const id of ids) {
            await this.#gate(id).exclusive(async (signal) => {
              this.#assertConnectionsQuiescent(id);
              await this.#beforeClose(id, signal, this.#disposeAfterClose ? 'shutdown' : 'close');
              signal.throwIfAborted();
              await this.#closeConnections(id);
            });
          }
        } finally {
          end();
        }
        if (!this.#opts.exclusiveServer || this.#disposeAfterClose) {
          this.#lease?.release();
          this.#lease = null;
          this.#directory.stores.delete(this);
        }
        if (this.#disposeAfterClose) this.#disposed = true;
      })
      .finally(() => {
        this.#closingAll = null;
      });
    return this.#closingAll;
  }

  /** 宿主退出后禁止这个实例再重新取得目录租约。 */
  async dispose(): Promise<void> {
    this.#disposeAfterClose = true;
    await this.closeAll();
  }

  #ensureLease(): void {
    this.#operations.assertAvailable();
    if (this.#disposed) throw maintenanceError('revoked');
    this.#lease ??= new DataDirectoryLease(this.#opts.dataDir, {
      server: this.#opts.exclusiveServer,
    });
    this.#lease.assertOwned();
    this.#directory.stores.add(this);
  }

  #gate(id: string): ResourceGate {
    const file = this.pathOf(id);
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || lstatSync(file).nlink !== 1))
      throw new BusinessError({
        code: 'BOOK_LINK_UNSUPPORTED',
        message: '账套文件不支持符号链接或硬链接',
      });
    const state = databaseFile(file);
    this.#known.add(id);
    state.gate.error = maintenanceError;
    return state.gate;
  }

  /** 新建账套：先写到临时文件，全部成功后再改名，避免留下半成品。 */
  async create(raw: CreateBookInput): Promise<BookInfo> {
    this.#ensureLease();
    return this.#operations.run(() => this.#create(raw));
  }

  async #create(raw: CreateBookInput): Promise<BookInfo> {
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
    const creating = openDatabase<CoreDB>(tmp);
    const { raw: rawDb, db } = creating;
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
      await creating.close();
      renameSync(tmp, this.pathOf(id));
    } catch (e) {
      await creating.close().catch(() => {});
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

function bookCloseError(error: unknown): unknown {
  if (error instanceof UnmanagedSqliteTransactionError)
    return new BusinessError({
      code: 'BOOK_RAW_TRANSACTION_ACTIVE',
      message: '账套仍有未登记的原生事务，不能关闭或维护',
      hint: '请由开启事务的代码显式提交或回滚后重试',
    });
  return error;
}

function maintenanceError(reason: 'busy' | 'timeout' | 'revoked'): BusinessError {
  return new BusinessError({
    code:
      reason === 'timeout'
        ? 'MAINTENANCE_TIMEOUT'
        : reason === 'revoked'
          ? 'BOOK_LEASE_EXPIRED'
          : 'BOOK_MAINTENANCE',
    message:
      reason === 'timeout'
        ? '等待账套维护超时，未结束任务仍保留占用'
        : reason === 'revoked'
          ? '账套租约已结束，请重新取得连接'
          : '账套正在维护或关闭，请稍后重试',
  });
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
