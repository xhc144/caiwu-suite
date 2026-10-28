import Database from 'better-sqlite3';
import { verifyPassword } from './password';
import { DataDirectoryLease } from './data-directory-lease';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
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
import { mapTemplateScheme, templateProblems } from '../template';
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
import { createCoreServices, authenticateUser } from './services';
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
  created?: (book: BookInfo) => Promise<void>;
  beforeClose?: (
    book: OpenBook,
    signal: AbortSignal,
    reason: 'close' | 'maintenance' | 'shutdown',
  ) => Promise<void>;
}

/** 覆盖仅接受受管暂存票据；独占维护内复核目标、保护备份及恢复校验。 */
export interface BookMaintenancePlan<T = void> {
  kind: 'reconnect' | 'delete' | 'replace';
  /** Opaque ticket returned by prepareReplacement; no filesystem paths accepted. */
  replacementId?: string;
  timeoutMs?: number;
  prepare?: (book: OpenBook, signal: AbortSignal) => Promise<T>;
  validate?: (book: OpenBook, signal: AbortSignal) => Promise<void>;
  onQuiesced?: () => Promise<void>;
}

const BOOK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type DirectoryState = {
  operations: ResourceGate;
  stores: Set<BookStore>;
  quarantines: Map<
    string,
    { protection: string; metadata: { length: number; sha256: string }; end?: () => void }
  >;
  creations: Map<string, { requestHash: string; task: Promise<BookInfo> }>;
};
const directories = new Map<string, DirectoryState>();

/**
 * 账套文件的管理：列出、新建、打开（缓存连接并执行迁移）、关闭。
 * 一个账套 = 一个 SQLite 文件。覆盖只能经受管恢复票据和独占维护；close/pathOf 不授权移动文件。
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
  readonly #replacements = new Map<
    string,
    {
      bookId: string;
      file: string;
      digest: string;
      length: number;
      expectedRevision: string;
      expiresAt: number;
      status: 'prepared' | 'applying' | 'done' | 'failed';
      protectionId?: string;
    }
  >();
  #disposeAfterClose = false;
  readonly #known = new Set<string>();

  constructor(opts: BookStoreOptions) {
    this.#opts = opts;
    this.#lease = new DataDirectoryLease(opts.dataDir, { server: opts.exclusiveServer });
    this.#directory = directories.get(this.#lease.directory) ?? {
      operations: new ResourceGate(maintenanceError),
      stores: new Set(),
      quarantines: new Map(),
      creations: new Map(),
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

  /** 内部收据/幂等发现：任一受管账套未能读取即拒绝；随后逐账套读取仍须 withBook。 */
  async listStrict(): Promise<BookSummary[]> {
    this.#ensureLease();
    return this.#operations.run(() => this.#list(true));
  }

  async #list(strict = false): Promise<BookSummary[]> {
    const out: BookSummary[] = [];
    for (const name of readdirSync(this.booksDir)) {
      const m = /^(.+)\.caiwu$/.exec(name);
      if (!m || !BookStore.isValidId(m[1]!)) {
        if (strict && name.endsWith('.caiwu')) throw bookScanError();
        continue;
      }
      const id = m[1]!;
      const file = path.join(this.booksDir, name);
      try {
        if (!strict && lstatSync(file).isSymbolicLink()) continue;
        this.#gate(id).assertAvailable();
        const raw =
          this.#open.get(id)?.raw ?? new Database(file, { readonly: true, fileMustExist: true });
        try {
          const row = raw.prepare('SELECT * FROM book_info WHERE id = 1').get() as
            CoreDB['book_info'] | undefined;
          const last = raw
            .prepare("SELECT value FROM book_setting WHERE scope = 'core' AND key = 'lastOpenedAt'")
            .get() as { value: string } | undefined;
          if (strict && (!row || row.book_id !== id)) throw bookScanError(id);
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
      } catch (error) {
        if (strict) {
          if (error instanceof BusinessError) throw error;
          throw bookScanError(id);
        }
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

  /** 独占维护；覆盖必须提供已校验、绑定目标版本的恢复计划。 */
  maintain<T>(id: string, plan: BookMaintenancePlan<T>): Promise<T | undefined> {
    if (isInDatabaseTransaction()) return Promise.reject(new Error('事务回调内不能启动账套维护'));
    if (plan.kind === 'delete' || (plan.kind === 'replace' && !plan.replacementId))
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
              if (plan.kind === 'replace') {
                await this.#replace(id, book, plan.replacementId!, signal, plan.validate);
                return undefined;
              }
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
              const quarantine = this.#directory.quarantines.get(id);
              if (quarantine) quarantine.end = end;
              else end();
            }
          }),
        plan.timeoutMs,
      ),
    );
  }

  /** Exact full-database revision, including module/report/print tables and committed WAL contents. */
  revision(id: string): string {
    const book = this.open(id);
    return createHash('sha256').update(book.raw.serialize()).digest('hex');
  }

  /** Stage verified bytes under a managed UUID. The ticket binds target contents and expires. */
  async prepareReplacement(input: {
    bookId: string;
    /** 已校验备份元数据中的源账套 ID；省略时只接受目标账套自己的备份。 */
    sourceBookId?: string;
    bytes: Uint8Array;
    length: number;
    sha256: string;
    expectedRevision: string;
    expiresAt: number;
  }) {
    return this.withBook(input.bookId, async (book) => {
      assertRestoreDatabase(book.raw, input.bookId);
      const sourceBookId = input.sourceBookId ?? input.bookId;
      if (!BookStore.isValidId(sourceBookId))
        throw new BusinessError({ code: 'RESTORE_BOOK', message: '备份源账套编号无效' });
      if (
        !Number.isFinite(input.expiresAt) ||
        input.expiresAt <= Date.now() ||
        input.expiresAt > Date.now() + 300_000
      )
        throw new BusinessError({
          code: 'RESTORE_PLAN_EXPIRED',
          message: '恢复确认已过期，请重新预览',
        });
      if (
        input.bytes.byteLength !== input.length ||
        input.length <= 0 ||
        input.length > 1024 ** 3 ||
        createHash('sha256').update(input.bytes).digest('hex') !== input.sha256
      )
        throw new BusinessError({
          code: 'RESTORE_DIGEST',
          message: '恢复文件长度或摘要不符，原账套保留',
        });
      if (this.revision(input.bookId) !== input.expectedRevision)
        throw new BusinessError({
          code: 'RESTORE_TARGET_CHANGED',
          message: '目标账套已变化，请重新预览',
        });
      const dir = this.#managedDirectory('restore-staging');
      const id = randomUUID(),
        file = path.join(dir, `${id}.sqlite`);
      writeFileSync(file, input.bytes, { flag: 'wx', mode: 0o600 });
      let source: Database.Database | undefined;
      try {
        source = new Database(file, { fileMustExist: true });
        source.pragma('trusted_schema = OFF');
        assertRestoreDatabase(source, sourceBookId);
        const known = new Map(
          this.#allMigrations().flatMap((set) =>
            set.migrations.map(
              (m) =>
                [
                  `${set.scope}/${m.id}`,
                  createHash('sha256').update(m.sql.replace(/\r\n/g, '\n').trim()).digest('hex'),
                ] as const,
            ),
          ),
        );
        for (const row of source.prepare('SELECT scope,id,checksum FROM _migration').all() as {
          scope: string;
          id: string;
          checksum: string;
        }[])
          if (known.get(`${row.scope}/${row.id}`) !== row.checksum)
            throw new BusinessError({
              code: 'RESTORE_VERSION',
              message: `备份迁移 ${row.scope}/${row.id} 与当前程序不兼容`,
            });
        runMigrations(source, this.#allMigrations());
        assertRestoreDatabase(source, sourceBookId);
        source.prepare('UPDATE book_info SET book_id=? WHERE id=1').run(input.bookId);
        source.pragma('wal_checkpoint(TRUNCATE)');
        source.pragma('journal_mode = DELETE');
        assertRestoreDatabase(source, input.bookId);
        source.close();
        source = undefined;
        const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
        this.#replacements.set(id, {
          bookId: input.bookId,
          file,
          digest,
          length: lstatSync(file).size,
          expectedRevision: input.expectedRevision,
          expiresAt: input.expiresAt,
          status: 'prepared',
        });
        return { replacementId: id, bookId: input.bookId, expiresAt: input.expiresAt };
      } catch (error) {
        source?.close();
        for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
        throw error;
      }
    });
  }

  replacementStatus(id: string) {
    const ticket = this.#replacements.get(id);
    if (!ticket)
      throw new BusinessError({
        code: 'RESTORE_PLAN_MISSING',
        message: '恢复计划不存在，请重新预览',
      });
    return {
      bookId: ticket.bookId,
      status: ticket.status,
      protectionId: ticket.protectionId ?? null,
      relogin: ticket.status === 'done',
    };
  }

  #managedDirectory(...segments: string[]): string {
    let directory = this.#lease!.directory;
    for (const segment of segments) {
      directory = path.join(directory, segment);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new BusinessError({ code: 'RESTORE_PATH', message: '恢复目录不是受管普通目录' });
    }
    return directory;
  }

  async #replace(
    id: string,
    book: OpenBook,
    replacementId: string,
    signal: AbortSignal,
    validate?: (book: OpenBook, signal: AbortSignal) => Promise<void>,
  ) {
    // Capture the existing gate before changing the target. Poisoning admission
    // after failed rollback must not depend on another filesystem lookup.
    const gate = this.#gate(id);
    const ticket = this.#replacements.get(replacementId);
    if (
      !ticket ||
      ticket.bookId !== id ||
      ticket.status !== 'prepared' ||
      ticket.expiresAt <= Date.now()
    )
      throw new BusinessError({
        code: 'RESTORE_PLAN_EXPIRED',
        message: '恢复计划不存在、已使用或过期，请重新预览',
      });
    assertRestoreDatabase(book.raw, id);
    if (this.revision(id) !== ticket.expectedRevision)
      throw new BusinessError({
        code: 'RESTORE_TARGET_CHANGED',
        message: '目标账套已变化，覆盖未执行',
      });
    const sourceStat = lstatSync(ticket.file);
    if (
      !sourceStat.isFile() ||
      sourceStat.isSymbolicLink() ||
      sourceStat.nlink !== 1 ||
      sourceStat.size !== ticket.length ||
      createHash('sha256').update(readFileSync(ticket.file)).digest('hex') !== ticket.digest
    )
      throw new BusinessError({
        code: 'RESTORE_DIGEST',
        message: '恢复暂存文件已变化，覆盖未执行',
      });
    ticket.status = 'applying';
    const protectionId = randomUUID();
    let protection = '';
    let replaced = false;
    let protectionMetadata: { length: number; sha256: string } | undefined;
    const verify = (file: string, expected: { length: number; sha256: string }) => {
      const stat = lstatSync(file),
        parent = lstatSync(path.dirname(file));
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size !== expected.length ||
        createHash('sha256').update(readFileSync(file)).digest('hex') !== expected.sha256
      )
        throw new BusinessError({
          code: 'RESTORE_DIGEST',
          message: '恢复暂存或保护备份的长度、摘要或文件类型已变化，原账套保护副本保留',
        });
    };
    const copy = async (from: string, to: string, abort?: AbortSignal) => {
      const expected =
        from === ticket.file
          ? { length: ticket.length, sha256: ticket.digest }
          : protectionMetadata!;
      verify(from, expected);
      const target = lstatSync(to),
        parent = lstatSync(path.dirname(to));
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        !target.isFile() ||
        target.isSymbolicLink() ||
        target.nlink !== 1
      )
        throw new BusinessError({
          code: 'RESTORE_PATH',
          message: '恢复目标必须是受管普通账套文件，不能覆盖符号链接或硬链接',
        });
      const source = new Database(from, { readonly: true, fileMustExist: true });
      try {
        assertRestoreDatabase(source, id);
        await source.backup(to, {
          progress: () => {
            abort?.throwIfAborted();
            return 128;
          },
        });
      } finally {
        source.close();
      }
    };
    try {
      signal.throwIfAborted();
      protection = path.join(
        this.#managedDirectory('core-protection', id),
        `${protectionId}.caiwu`,
      );
      await book.raw.backup(protection, {
        progress: () => {
          signal.throwIfAborted();
          return 128;
        },
      });
      const backup = new Database(protection, { readonly: true, fileMustExist: true });
      try {
        assertRestoreDatabase(backup, id);
      } finally {
        backup.close();
      }
      const bytes = readFileSync(protection);
      const metadata = {
        bookId: id,
        length: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        createdAt: new Date().toISOString(),
      };
      protectionMetadata = metadata;
      writeFileSync(`${protection}.json`, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 });
      ticket.protectionId = protectionId;
      const checkpoint = book.raw.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
      if (checkpoint.some((row) => row.busy !== 0))
        throw new BusinessError({
          code: 'RESTORE_SQLITE_BUSY',
          message: '仍有 SQLite 事务占用，覆盖未执行',
        });
      signal.throwIfAborted();
      verify(protection, protectionMetadata);
      await this.#closeConnections(id);
      // SQLite's backup transaction replaces database contents atomically. Never unlink or rename an open main/WAL file.
      // Once replacement starts, treat an interrupted/uncertain copy as changed and restore protection.
      replaced = true;
      await copy(ticket.file, this.pathOf(id), signal);
      const reopened = this.open(id);
      assertRestoreDatabase(reopened.raw, id);
      await validate?.(reopened, signal);
      signal.throwIfAborted();
      assertRestoreDatabase(reopened.raw, id);
      ticket.status = 'done';
      rmSync(ticket.file, { force: true });
    } catch (error) {
      ticket.status = 'failed';
      if (replaced) {
        try {
          await this.#closeConnections(id);
          await copy(protection, this.pathOf(id));
          const restored = this.open(id);
          assertRestoreDatabase(restored.raw, id);
        } catch (rollbackError) {
          // The replacement has been rejected and rollback is uncertain. Never admit
          // this database again merely because the exclusive callback has finished.
          this.#directory.quarantines.set(id, { protection, metadata: protectionMetadata! });
          gate.block();
          const marker = `${book.file}.quarantine.json`;
          try {
            writeFileSync(
              marker,
              JSON.stringify({ bookId: id, protectionId, ...protectionMetadata }),
              { flag: 'wx', mode: 0o600 },
            );
          } catch {
            /* The runtime maintenance marker and gate remain closed even if disk writes fail. */
          }
          throw new AggregateError(
            [error, rollbackError],
            '恢复及回滚未完成，目标账套已隔离，保护备份保留；请修复存储后由管理员调用 recoverQuarantined 复核原账名称及密码恢复保护副本',
            { cause: rollbackError },
          );
        }
      } else {
        this.open(id);
      }
      throw error;
    }
  }

  /** Host recovery only: authenticate against the original protection copy while the target stays isolated. */
  async recoverQuarantined(input: {
    bookId: string;
    bookName: string;
    adminCode: string;
    password: string;
  }): Promise<void> {
    const id = input.bookId;
    this.#ensureLease();
    const quarantine = this.#directory.quarantines.get(id);
    if (!quarantine || !quarantine.end)
      throw new BusinessError({
        code: 'RESTORE_RECOVERY_UNAVAILABLE',
        message: '没有本实例可安全恢复的隔离账套，请保留运行锁和保护备份并联系维护人员',
      });
    return this.#operations.run(() =>
      this.#gate(id).recover(async () => {
        const stat = lstatSync(quarantine.protection);
        const parent = lstatSync(path.dirname(quarantine.protection));
        const bytes = readFileSync(quarantine.protection);
        if (
          !parent.isDirectory() ||
          parent.isSymbolicLink() ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          bytes.length !== quarantine.metadata.length ||
          createHash('sha256').update(bytes).digest('hex') !== quarantine.metadata.sha256
        )
          throw new BusinessError({
            code: 'RESTORE_DIGEST',
            message: '保护备份已变化，账套继续隔离，请联系维护人员',
          });
        const source = new Database(quarantine.protection, { readonly: true, fileMustExist: true });
        try {
          assertRestoreDatabase(source, id);
          const info = source.prepare('SELECT book_id, name FROM book_info WHERE id=1').get() as {
            book_id: string;
            name: string;
          };
          const admin = source
            .prepare(
              'SELECT password_hash FROM app_user WHERE code=? AND is_admin=1 AND disabled=0',
            )
            .get(input.adminCode) as { password_hash: string } | undefined;
          if (
            info.book_id !== id ||
            info.name !== input.bookName ||
            !admin ||
            !(await verifyPassword(input.password, admin.password_hash))
          )
            throw new BusinessError({
              code: 'RESTORE_CONFIRM_FAILED',
              message: '请准确输入原账套名称及原管理员账号密码，账套继续隔离',
            });
          this.#assertConnectionsQuiescent(id);
          await this.#closeConnections(id);
          const target = lstatSync(this.pathOf(id));
          if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1)
            throw new BusinessError({
              code: 'RESTORE_PATH',
              message: '恢复目标不是受管普通账套文件，账套继续隔离',
            });
          await source.backup(this.pathOf(id));
          const restored = new Database(this.pathOf(id), { fileMustExist: true });
          try {
            assertRestoreDatabase(restored, id);
            runMigrations(restored, this.#allMigrations());
            assertRestoreDatabase(restored, id);
          } finally {
            restored.close();
          }
          rmSync(`${this.pathOf(id)}.quarantine.json`, { force: true });
          quarantine.end!();
          this.#directory.quarantines.delete(id);
        } finally {
          source.close();
        }
      }),
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
    if (existsSync(`${file}.quarantine.json`)) state.gate.block();
    return state.gate;
  }

  /** 新建账套：先写到临时文件，全部成功后再改名，避免留下半成品。 */
  async create(raw: CreateBookInput): Promise<BookInfo> {
    this.#ensureLease();
    const input = CreateBookInputSchema.parse(raw);
    if (!input.requestKey) return this.#operations.run(() => this.#create(input));
    const requestKey = input.requestKey;
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.#directory.creations.get(requestKey);
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new BusinessError({
          code: 'BOOK_CREATE_CONFLICT',
          message: '同一次建账请求被用于不同内容，请重新发起建账',
        });
      return existing.task;
    }
    const hex = createHash('sha256')
      .update(`caiwu-book-request:${requestKey}`)
      .digest('hex')
      .slice(0, 32)
      .split('');
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
    const text = hex.join('');
    const id = `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
    const { adminPassword: _password, requestKey: _key, ...payload } = input;
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const task = this.#operations.run(() =>
      this.#gate(id).exclusive(() =>
        this.#operations.runFresh(async () => {
          if (existsSync(this.pathOf(id))) {
            const book = this.open(id);
            const stored = await book.db
              .selectFrom('book_setting')
              .select('value')
              .where('scope', '=', 'core')
              .where('key', '=', 'creationRequest')
              .executeTakeFirst();
            const metadata = stored
              ? (JSON.parse(stored.value) as { requestKey: string; payloadHash: string })
              : null;
            const admin = await authenticateUser(book.db, input.adminCode, input.adminPassword);
            if (
              metadata?.requestKey !== requestKey ||
              metadata.payloadHash !== payloadHash ||
              !admin?.isAdmin
            )
              throw new BusinessError({
                code: 'BOOK_CREATE_CONFLICT',
                message: '该建账请求已有结果，但内容或管理员口令不同；原账套已保留',
                hint: '请在账套列表核对并登录已有账套；需要另建时使用新的请求编号',
              });
            return toBookInfo(
              await book.db
                .selectFrom('book_info')
                .selectAll()
                .where('id', '=', 1)
                .executeTakeFirstOrThrow(),
            );
          }
          return this.#create(input, id, { requestKey, payloadHash });
        }),
      ),
    );
    this.#directory.creations.set(requestKey, { requestHash, task });
    void task.finally(() => this.#directory.creations.delete(requestKey)).catch(() => {});
    return task;
  }

  async #create(
    raw: CreateBookInput,
    id: string = randomUUID(),
    creation?: { requestKey: string; payloadHash: string },
  ): Promise<BookInfo> {
    const input = CreateBookInputSchema.parse(raw);
    const nativeTemplate = this.#opts.templates.get(input.templateId);
    const scheme = parseCodeScheme(input.codeScheme ?? nativeTemplate.codeScheme);
    const template = mapTemplateScheme(nativeTemplate, scheme);
    const problems = templateProblems(template, scheme);
    if (problems.length) {
      throw new BusinessError({
        code: 'TEMPLATE_SCHEME_MISMATCH',
        message: `「${template.name}」不能使用科目级次 ${formatCodeScheme(scheme)}：${problems[0]}`,
        hint: `这个模板默认的级次是 ${template.codeScheme}`,
        details: { problems },
      });
    }
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
        if (creation)
          await trx
            .insertInto('book_setting')
            .values({
              scope: 'core',
              key: 'creationRequest',
              value: JSON.stringify(creation),
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
              isContra: a.isContra,
              balanceNature: a.balanceNature,
              closingRule: a.closingRule,
              source: a.source,
              sourceVersion: a.sourceVersion,
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
    const info = await createCoreServices({
      db: opened.db,
      user: { id: 0, code: 'system', name: '系统', isAdmin: true, permissions: new Set() },
      moduleId: null,
      now: () => new Date(),
      modules: emptyModuleLookup,
    }).book.info();
    await this.#opts.created?.(info);
    return info;
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

function bookScanError(bookId?: string): BusinessError {
  return new BusinessError({
    code: 'BOOK_SCAN_INCOMPLETE',
    message: '账套未能完整读取，已停止本次账套扫描',
    hint: '请等待账套维护结束或修复无法读取的账套后重试',
    details: { bookId: bookId ?? null },
  });
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

function assertRestoreDatabase(raw: Database.Database, expectedBookId: string): void {
  // Match the established backup validator; do not introduce a weaker restore route.
  const unsupported = raw
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type IN ('trigger','view') OR upper(sql) LIKE '%CREATE VIRTUAL TABLE%' LIMIT 1",
    )
    .get();
  if (unsupported)
    throw new BusinessError({
      code: 'RESTORE_SCHEMA',
      message: '备份包含本版本未支持的触发器、视图或虚拟表',
    });
  if (
    raw.pragma('integrity_check', { simple: true }) !== 'ok' ||
    (raw.pragma('foreign_key_check') as unknown[]).length
  )
    throw new BusinessError({ code: 'RESTORE_INTEGRITY', message: '备份 SQLite 完整性检查失败' });
  const row = raw.prepare('SELECT book_id FROM book_info WHERE id=1').get() as
    { book_id: string } | undefined;
  if (!row || !BookStore.isValidId(row.book_id))
    throw new BusinessError({ code: 'RESTORE_BOOK', message: '备份账套信息无效' });
  if (row.book_id !== expectedBookId)
    throw new BusinessError({
      code: 'RESTORE_BOOK_MISMATCH',
      message: '账套文件身份与确认的源账套或目标账套不符，恢复未完成',
      hint: '请重新核对备份来源及目标账套，保留原账套和保护备份',
    });
}
