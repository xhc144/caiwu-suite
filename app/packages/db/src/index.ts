import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ResourceGate } from './lifecycle';
export { ResourceGate, withRequestLeases, type GateError } from './lifecycle';
import {
  Kysely,
  SqliteAdapter,
  SqliteDialect,
  SqliteDriver,
  type DatabaseConnection,
  type DialectAdapter,
  type Driver,
} from 'kysely';

export {
  sql,
  Kysely,
  type Transaction,
  type Selectable,
  type Insertable,
  type Updateable,
  type Generated,
  type ColumnType,
} from 'kysely';

export type RawDatabase = Database.Database;

export interface OpenedDatabase<DB> {
  /** better-sqlite3 原始连接。只在迁移、备份这类底层操作里用。 */
  raw: RawDatabase;
  /** Kysely 实例。业务代码一律用它。 */
  db: Kysely<DB>;
  close(): Promise<void>;
}

/**
 * 打开一个 SQLite 文件（或 `:memory:`）。
 * 统一设置：外键开启、WAL、忙等待 5 秒。
 */
const files = new Map<string, DatabaseFile>();

export interface DatabaseFile {
  gate: ResourceGate;
  connections: Set<OpenedDatabase<unknown>>;
  closing: number;
}

/** 同一进程通过本包打开的同一真实路径共用门和连接登记；直接 new Database 不在协议内。 */
export function databaseFile(file: string): DatabaseFile {
  const key =
    file === ':memory:'
      ? null
      : existsSync(file)
        ? realpathSync(file)
        : path.join(realpathSync(path.dirname(file)), path.basename(file));
  if (key && files.has(key)) return files.get(key)!;
  const state = {
    gate: new ResourceGate(),
    connections: new Set<OpenedDatabase<unknown>>(),
    closing: 0,
  };
  if (key) files.set(key, state);
  return state;
}

export function openDatabase<DB>(file: string): OpenedDatabase<DB> {
  const state = databaseFile(file);
  state.gate.retainForRequest();
  state.gate.assertAvailable();
  if (state.closing) throw state.gate.error('busy');
  const raw = new Database(file);
  try {
    raw.pragma('foreign_keys = ON');
    raw.pragma('busy_timeout = 5000');
    if (file !== ':memory:') {
      raw.pragma('journal_mode = WAL');
      raw.pragma('synchronous = NORMAL');
    }
  } catch (error) {
    raw.close();
    throw error;
  }
  const db = new Kysely<DB>({ dialect: new GuardedSqliteDialect({ database: raw }, state.gate) });
  let closing: Promise<void> | undefined;
  const destroy = db.destroy.bind(db);
  const opened: OpenedDatabase<DB> = {
    raw,
    db,
    close() {
      if (transactionScope.getStore()?.active)
        return Promise.reject(new Error('事务回调内不能关闭数据库连接'));
      if (closing) return closing;
      state.closing++;
      closing = destroy()
        .then(() => {
          // Kysely 未初始化 driver 时 destroy 不会关闭构造时已打开的原生连接。
          if (raw.open) {
            if (raw.inTransaction) throw new Error('仍有未登记的原生事务，不能关闭数据库');
            raw.close();
          }
          state.connections.delete(opened as OpenedDatabase<unknown>);
        })
        .catch((error: unknown) => {
          state.gate.block();
          throw error;
        })
        .finally(() => {
          state.closing--;
        });
      return closing;
    },
  };
  db.destroy = opened.close;
  state.connections.add(opened as OpenedDatabase<unknown>);
  return opened;
}

/** 调用者须先关门并排空请求；包括通过本包打开的额外连接，关闭期间禁止重新 open。 */
export async function closeDatabaseFile(file: string): Promise<void> {
  const state = databaseFile(file);
  state.closing++;
  try {
    await Promise.all([...state.connections].map((c) => c.close()));
  } catch (error) {
    state.gate.block();
    throw error;
  } finally {
    state.closing--;
  }
}

/**
 * SQLite 只有一个连接：事务进行中，事务外的查询要排队等事务结束。
 * 如果在事务回调里又用了事务外的 db（或事务外创建的服务对象），就会自己等自己，永远卡住。
 * 这里在同一条异步调用链里检测这种用法，直接抛出说明清楚的错误。
 *
 * 实现：连接锁由我们自己的驱动管理（Kysely 自带的锁在驱动外层，等锁时没有机会检查），
 * 先检查、再排队。
 */
const transactionScope = new AsyncLocalStorage<{ active: boolean }>();

export function isInDatabaseTransaction(): boolean {
  return transactionScope.getStore()?.active ?? false;
}

class GuardedSqliteDriver extends SqliteDriver {
  #closing = false;
  #gateRelease: (() => void) | null = null;
  constructor(
    config: ConstructorParameters<typeof SqliteDriver>[0],
    readonly gate: ResourceGate,
  ) {
    super(config);
  }
  #locked: Promise<void> | null = null;
  #release: (() => void) | null = null;

  override async acquireConnection(): Promise<DatabaseConnection> {
    if (transactionScope.getStore()?.active) {
      throw new Error(
        '在事务里用了事务外的数据库连接，会卡死。事务回调里只能用回调传进来的 trx（或 svc.tx 回调传进来的 svc）。',
      );
    }
    const release = this.gate.enter();
    try {
      while (this.#locked) await this.#locked;
      if (this.#closing) throw new Error('数据库连接正在关闭');
      this.#locked = new Promise((resolve) => (this.#release = resolve));
      this.#gateRelease = release;
      return await super.acquireConnection();
    } catch (error) {
      release();
      throw error;
    }
  }

  override async releaseConnection(): Promise<void> {
    await super.releaseConnection();
    const release = this.#release;
    this.#locked = null;
    this.#release = null;
    release?.();
    this.#gateRelease?.();
    this.#gateRelease = null;
  }

  override async destroy(): Promise<void> {
    this.#closing = true;
    while (this.#locked) await this.#locked;
    await super.destroy();
  }
}

class GuardedSqliteAdapter extends SqliteAdapter {
  // 让 Kysely 不再在外层加锁，由 GuardedSqliteDriver 自己加锁
  override get supportsMultipleConnections(): boolean {
    return true;
  }
}

class GuardedSqliteDialect extends SqliteDialect {
  readonly #config: ConstructorParameters<typeof SqliteDialect>[0];
  constructor(
    config: ConstructorParameters<typeof SqliteDialect>[0],
    readonly gate: ResourceGate,
  ) {
    super(config);
    this.#config = config;
  }
  override createDriver(): Driver {
    return new GuardedSqliteDriver(this.#config, this.gate);
  }
  override createAdapter(): DialectAdapter {
    return new GuardedSqliteAdapter();
  }
}

/**
 * 在事务里执行。传进来的已经是事务就直接用它（SQLite 不支持嵌套事务）。
 * 业务服务里需要"要么全成功要么全不做"的地方都用它。
 */
export async function withTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) return fn(db);
  return db.transaction().execute((trx) => {
    const scope = { active: true };
    return transactionScope.run(scope, async () => {
      try {
        return await fn(trx);
      } finally {
        scope.active = false;
      }
    });
  });
}

// ---------------------------------------------------------------- 迁移

export interface Migration {
  /** 形如 `0001_init`：四位序号 + 下划线 + 英文说明。按 id 字典序执行。 */
  id: string;
  /** 纯 SQL，可以包含多条语句。 */
  sql: string;
}

export interface MigrationSet {
  /** 迁移归属：`core` 或模块 id。 */
  scope: string;
  migrations: readonly Migration[];
}

const MIGRATION_ID = /^\d{4}_[a-z0-9_]+$/;

/** 声明一组迁移。只做格式检查，方便在模块里写成常量。 */
export function defineMigrations(migrations: Migration[]): readonly Migration[] {
  const seen = new Set<string>();
  for (const m of migrations) {
    if (!MIGRATION_ID.test(m.id)) {
      throw new Error(`迁移 id "${m.id}" 格式不对，应为 0001_name（小写字母、数字、下划线）`);
    }
    if (seen.has(m.id)) throw new Error(`迁移 id "${m.id}" 重复`);
    seen.add(m.id);
  }
  return Object.freeze([...migrations].sort((a, b) => a.id.localeCompare(b.id)));
}

function checksum(sqlText: string): string {
  return createHash('sha256').update(sqlText.replace(/\r\n/g, '\n').trim()).digest('hex');
}

export interface MigrationResult {
  applied: { scope: string; id: string }[];
}

/**
 * 按给定顺序执行迁移集合。已执行的跳过；已执行但内容变了直接报错（不许改已发布的迁移）。
 * 每条迁移单独一个事务。
 */
export function runMigrations(raw: RawDatabase, sets: readonly MigrationSet[]): MigrationResult {
  raw.exec(`CREATE TABLE IF NOT EXISTS _migration (
    scope TEXT NOT NULL,
    id TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (scope, id)
  )`);
  const getApplied = raw.prepare<[string, string], { checksum: string }>(
    'SELECT checksum FROM _migration WHERE scope = ? AND id = ?',
  );
  const insert = raw.prepare(
    'INSERT INTO _migration (scope, id, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const applied: MigrationResult['applied'] = [];
  const scopes = new Set<string>();
  for (const set of sets) {
    if (scopes.has(set.scope)) throw new Error(`迁移归属 "${set.scope}" 重复`);
    scopes.add(set.scope);
    for (const m of set.migrations) {
      const sum = checksum(m.sql);
      const existing = getApplied.get(set.scope, m.id);
      if (existing) {
        if (existing.checksum !== sum) {
          throw new Error(
            `迁移 ${set.scope}/${m.id} 已经执行过，但内容被改了。已执行的迁移不能修改，请新增一条迁移。`,
          );
        }
        continue;
      }
      const tx = raw.transaction(() => {
        raw.exec(m.sql);
        insert.run(set.scope, m.id, sum, new Date().toISOString());
      });
      try {
        tx();
      } catch (err) {
        throw new Error(`执行迁移 ${set.scope}/${m.id} 失败：${(err as Error).message}`, {
          cause: err,
        });
      }
      applied.push({ scope: set.scope, id: m.id });
    }
  }
  return { applied };
}

/**
 * 按模块依赖排序：先 core，再按依赖拓扑序，同层按 id 字典序。
 * 依赖不存在或成环时报错。
 */
export function orderByDependencies<T extends { id: string; dependsOn?: readonly string[] }>(
  items: readonly T[],
): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const result: T[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (item: T, trail: string[]) => {
    const s = state.get(item.id);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`模块依赖成环：${[...trail, item.id].join(' → ')}`);
    state.set(item.id, 'visiting');
    for (const dep of [...(item.dependsOn ?? [])].sort()) {
      const target = byId.get(dep);
      if (!target) throw new Error(`模块 "${item.id}" 依赖的模块 "${dep}" 不存在`);
      visit(target, [...trail, item.id]);
    }
    state.set(item.id, 'done');
    result.push(item);
  };
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) visit(item, []);
  return result;
}
