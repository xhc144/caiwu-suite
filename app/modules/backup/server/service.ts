import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  authenticateUser,
  createCoreServices,
  loadServiceUser,
  withServiceScope,
  type CoreServices,
} from '@caiwu/core/server';
import type { AppRuntime, AuthedContext } from '@caiwu/server-kit';
import { BusinessError } from '@caiwu/core';
import {
  ConfirmSchema,
  CreateSchema,
  DeleteSchema,
  DEFAULT_SETTINGS,
  MetadataSchema,
  NameSchema,
  SettingsSchema,
  TRANSFER_LIMIT,
  UploadSchema,
  type BackupSettings,
} from '../shared';
import type { BackupTables } from './migrations';
import {
  directory,
  fail,
  fileError,
  hashFile,
  inspectSqlite,
  packagePath,
  MAX_LOCAL,
  probeDirectory,
  regularFile,
  validatePackage,
  writePackage,
} from './files';

type Context = AuthedContext & { app: AppRuntime };
type Protection = {
  protectionId: string;
  createdAt: string;
  location: string;
  confirmation: string;
  available: boolean;
  expiresAt: string;
};
type LocalBackup = Readonly<BackupTables['backup_item']>;
type Overwrite = {
  revision: string;
  replacementId?: string;
  protection?: Protection;
  localBackups?: readonly LocalBackup[];
};
type Job = { bookId: string; abort: AbortController; promise: Promise<void>; progress: number };
type Terminal = { status: 'failed' | 'cancelled'; reason: string };
type FinalFailure = {
  bookId: string;
  error: unknown;
  user: Context['user'];
  terminal: Terminal;
  recovering?: Promise<void>;
};

async function writeFailure(svc: CoreServices, id: string, terminal: Terminal) {
  const updated = await svc.db
    .withTables<BackupTables>()
    .updateTable('backup_item')
    .set(terminal)
    .where('id', '=', id)
    .executeTakeFirst();
  if (updated.numUpdatedRows !== 1n)
    throw fail('FINAL_STATE', '备份终态记录不存在，不能确认安全关闭');
  await svc.log.write({
    action: 'backup.failed',
    summary: terminal.reason,
    targetType: 'backup_item',
    targetId: id,
  });
}

/** 单次扫描，常量栈空间；重复分组正则会在数 MiB 的合法输入上耗尽 V8 栈。 */
function decodeUploadBase64(text: string): Buffer {
  const invalid = () => fail('ENCODING', '上传内容不是有效的完整 base64 文件');
  if (text.length === 0 || text.length % 4 !== 0) throw invalid();
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const contentEnd = text.length - padding;
  for (let i = 0; i < contentEnd; i++) {
    const code = text.charCodeAt(i);
    if (
      !(code >= 65 && code <= 90) &&
      !(code >= 97 && code <= 122) &&
      !(code >= 48 && code <= 57) &&
      code !== 43 &&
      code !== 47
    )
      throw invalid();
  }
  // Node 的解码器会忽略未使用的低位；明确拒绝非规范填充，避免多种编码表示同一内容。
  const lastValue = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(
    text.charAt(contentEnd - 1),
  );
  if ((padding === 2 && (lastValue & 15) !== 0) || (padding === 1 && (lastValue & 3) !== 0))
    throw invalid();
  if ((text.length / 4) * 3 - padding > TRANSFER_LIMIT)
    throw fail('TRANSFER_SIZE', '文件超过 32 MiB 浏览器传输上限');
  return Buffer.from(text, 'base64');
}

const states = new WeakMap<
  AppRuntime,
  {
    busy: Set<string>;
    failures: Map<string, FinalFailure>;
    jobs: Map<string, Job>;
    creating: Map<string, Promise<BackupTables['backup_item']>>;
    preparing: Map<string, Promise<Protection>>;
    overwrites: Map<string, Overwrite>;
  }
>();
function state(app: AppRuntime) {
  let s = states.get(app);
  if (!s) {
    s = {
      busy: new Set(),
      failures: new Map(),
      jobs: new Map(),
      creating: new Map(),
      preparing: new Map(),
      overwrites: new Map(),
    };
    states.set(app, s);
  }
  return s;
}
// 只串行本模块文件作业；这不是跨模块维护锁，禁止以此在线覆盖账套。
async function exclusive<T>(ctx: Context, fn: () => Promise<T>) {
  const s = state(ctx.app);
  const id = ctx.book.id;
  if (s.busy.has(id))
    throw fail('BUSY', '当前账套有备份或引入正在执行', '等待完成，或取消尚未完成的备份后重试');
  s.busy.add(id);
  try {
    return await fn();
  } finally {
    s.busy.delete(id);
  }
}
/** 关闭前必须等到真实结束；写入失败保留为关闭阻塞，不能用 console.error 冒充成功。 */
export async function waitForJobs(app: AppRuntime, bookId?: string, signal?: AbortSignal) {
  const s = state(app);
  const matches = (job: { bookId: string }) => !bookId || job.bookId === bookId;
  const abort = () => {
    for (const job of s.jobs.values()) if (matches(job)) job.abort.abort(signal?.reason);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    await Promise.allSettled([...s.jobs.values()].filter(matches).map((j) => j.promise));
    for (const [id, failure] of [...s.failures]) {
      if (!matches(failure)) continue;
      signal?.throwIfAborted();
      failure.recovering ??= withServiceScope(() =>
        app.bookStore.withBook(failure.bookId, async (book) => {
          const svc = createCoreServices({
            db: book.db,
            user: failure.user,
            moduleId: 'backup',
            now: app.now,
            modules: app.modules.lookup,
          });
          await svc.tx(async (tx) => {
            signal?.throwIfAborted();
            await writeFailure(tx, id, failure.terminal);
            signal?.throwIfAborted();
          });
          if (s.failures.get(id) === failure) s.failures.delete(id);
        }),
      );
      try {
        await failure.recovering;
      } catch (error) {
        failure.error = error;
      } finally {
        failure.recovering = undefined;
      }
    }
    const errors = [...s.failures.values()].filter(matches).map((f) => f.error);
    if (errors.length)
      throw new AggregateError(errors, '备份最终状态或日志未能保存，不能安全关闭账套');
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** 仅接受替换前目标本机的登记；源机器快照中的目录和文件登记不参与保留。 */
async function verifiedLocalBackup(app: AppRuntime, bookId: string, row: LocalBackup) {
  if (row.owner_id !== bookId || row.status !== 'valid')
    throw fail('CATALOG', '本机备份登记不属于覆盖目标或尚未校验通过');
  const file = packagePath(await directory(app.dataDir, bookId, row.directory), row.id);
  const checked = await validatePackage(file, app);
  try {
    if (checked.digest !== row.digest)
      throw fail('CHANGED', '本机备份与登记摘要不符，覆盖未完成', '请重新校验本机备份后再预览恢复');
    return Object.freeze({
      ...row,
      metadata: JSON.stringify(checked.metadata),
      bytes: checked.bytes,
      digest: checked.digest,
      reason: '',
      progress: 100,
    });
  } finally {
    await rm(checked.snapshot, { force: true });
  }
}

// 每次取得租约后重新构造，禁止后台作业捕获已返回 HTTP 请求的 db/svc。
function backupOperations(ctx: Context) {
  const db = ctx.svc.db.withTables<BackupTables>();
  const now = () => ctx.app.now().toISOString();
  const load = async (id: string) => {
    const row = await db
      .selectFrom('backup_item')
      .selectAll()
      .where('id', '=', id)
      .where('owner_id', '=', ctx.book.id)
      .executeTakeFirst();
    if (!row) throw fail('NOT_FOUND', '当前账套没有这份受管备份');
    return row;
  };
  const fileOf = async (row: Awaited<ReturnType<typeof load>>) =>
    packagePath(await directory(ctx.app.dataDir, ctx.book.id, row.directory), row.id);
  const verify = async (id: string, includeContent = false) => {
    const row = await load(id);
    if (!['valid', 'invalid'].includes(row.status))
      throw fail('STATE', '这份备份尚未完成或已删除', '请选择已完成的备份');
    try {
      const checked = await validatePackage(await fileOf(row), ctx.app, includeContent);
      if (row.digest !== checked.digest) {
        await rm(checked.snapshot);
        throw fail('CHANGED', '受管备份与登记摘要不符');
      }
      if (row.status !== 'valid' || row.reason)
        await db
          .updateTable('backup_item')
          .set({ status: 'valid', reason: '' })
          .where('id', '=', id)
          .execute();
      return checked;
    } catch (e) {
      const err = fileError(e);
      await db
        .updateTable('backup_item')
        .set({ status: 'invalid', reason: err.message })
        .where('id', '=', id)
        .execute();
      throw err;
    }
  };
  const settings = async () =>
    SettingsSchema.parse(await ctx.svc.settings.get('automatic', DEFAULT_SETTINGS));
  const doBackup = async (id: string, signal: AbortSignal) => {
    const row = await load(id);
    const dir = await directory(ctx.app.dataDir, ctx.book.id, row.directory);
    const snapshot = path.join(dir, `.${id}.snapshot`);
    const tmp = path.join(dir, `.${id}.partial`);
    const checkCancelled = () => {
      if (signal.aborted) throw fail('CANCELLED', '备份已取消，未发布半成品');
    };
    try {
      const estimate = ctx.book.raw.pragma('page_count', { simple: true }) as number;
      const pageSize = ctx.book.raw.pragma('page_size', { simple: true }) as number;
      if (estimate * pageSize > MAX_LOCAL)
        throw fail(
          'LOCAL_SIZE',
          '当前阶段单份本机备份最多支持 1 GiB',
          '请保留原账套；需要扩展受管大文件校验和传输接口后再备份',
        );
      await probeDirectory(dir, estimate * pageSize * 3 + 1024 * 1024);
      await ctx.svc.log.write({
        action: `backup.${row.kind}.start`,
        summary: `开始完整备份：${row.name}`,
      });
      checkCancelled();
      // SQLite 原生 online backup：包含 WAL 中已提交内容及所有模块表。
      await ctx.book.raw.backup(snapshot, {
        progress: ({ remainingPages, totalPages }) => {
          checkCancelled();
          const percent = totalPages
            ? Math.floor(((totalPages - remainingPages) / totalPages) * 80)
            : 0;
          const job = state(ctx.app).jobs.get(id);
          if (job) job.progress = percent;
          return 128;
        },
      });
      checkCancelled();
      const content = inspectSqlite(snapshot, ctx.app);
      const metadata = MetadataSchema.parse({
        format: 'caiwu-sqlite-backup',
        version: 1,
        appVersion: ctx.app.version,
        createdAt: row.created_at,
        type: row.kind,
        length: (await stat(snapshot)).size,
        sha256: await hashFile(snapshot),
        ...content,
      });
      await writePackage(snapshot, tmp, metadata);
      const checked = await validatePackage(tmp, ctx.app);
      await rm(checked.snapshot);
      checkCancelled();
      await link(tmp, packagePath(dir, id));
      await rm(tmp);
      await db
        .updateTable('backup_item')
        .set({
          status: 'valid',
          metadata: JSON.stringify(metadata),
          digest: checked.digest,
          bytes: checked.bytes,
          progress: 100,
          reason: '',
        })
        .where('id', '=', id)
        .execute();
      await ctx.svc.log.write({
        action: 'backup.complete',
        summary: `完整备份已校验：${row.name}`,
        targetType: 'backup_item',
        targetId: id,
      });
    } finally {
      for (const file of [snapshot, `${snapshot}-wal`, `${snapshot}-shm`, tmp])
        await rm(file, { force: true });
    }
  };
  const pruneAutomatic = async (keep: number) => {
    const rows = await db
      .selectFrom('backup_item')
      .selectAll()
      .where('owner_id', '=', ctx.book.id)
      .where('kind', '=', 'automatic')
      .where('status', '=', 'valid')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const valid: typeof rows = [];
    for (const row of rows) {
      try {
        const checked = await verify(row.id);
        await rm(checked.snapshot);
        valid.push(row);
      } catch {
        /* 损坏、外部改写或丢失文件不参与轮替。 */
      }
    }
    const removed: string[] = [];
    for (const row of valid.slice(Math.max(1, keep))) {
      const file = await fileOf(row);
      await regularFile(file);
      await rm(file);
      await db
        .updateTable('backup_item')
        .set({ status: 'pruned', reason: '超过自动备份保留份数' })
        .where('id', '=', row.id)
        .execute();
      removed.push(row.id);
    }
    return removed;
  };
  return { db, now, load, fileOf, verify, settings, doBackup, pruneAutomatic };
}

export function backupService(ctx: Context) {
  const { db, now, load, fileOf, verify, settings } = backupOperations(ctx);
  const admin = () => {
    if (!ctx.user.isAdmin)
      throw fail('ADMIN', '恢复账套需要当前账套管理员', '请使用管理员重新登录');
  };
  const startBackup = async (
    input: { requestId: string; name: string },
    kind: 'manual' | 'automatic' | 'pre-restore' = 'manual',
    synchronous = false,
  ) => {
    const data = CreateSchema.parse(input);
    const previous = await db
      .selectFrom('backup_item')
      .selectAll()
      .where('request_id', '=', data.requestId)
      .where('owner_id', '=', ctx.book.id)
      .executeTakeFirst();
    if (previous) return previous;
    if (state(ctx.app).busy.has(ctx.book.id)) throw fail('BUSY', '当前账套有备份或引入正在执行');
    state(ctx.app).busy.add(ctx.book.id);
    try {
      const config = await settings();
      const id = randomUUID();
      await db
        .insertInto('backup_item')
        .values({
          id,
          owner_id: ctx.book.id,
          request_id: data.requestId,
          name: data.name,
          directory: kind === 'automatic' ? config.directory : '手动与保护',
          kind,
          status: 'running',
          reason: '',
          metadata: null,
          bytes: 0,
          digest: null,
          created_at: now(),
          progress: 0,
          retention_note: '',
        })
        .execute();
      const abort = new AbortController();
      let terminal: Terminal | undefined;
      const originalUser = { ...ctx.user, permissions: new Set(ctx.user.permissions) };
      const promise = ctx.app.bookStore
        .withBook(ctx.book.id, async (book) => {
          const user = await loadServiceUser(book.db, ctx.user.id);
          const svc = createCoreServices({
            db: book.db,
            user: user ?? ctx.user,
            moduleId: 'backup',
            now: ctx.app.now,
            modules: ctx.app.modules.lookup,
          });
          const { db, doBackup, pruneAutomatic } = backupOperations({
            ...ctx,
            book,
            user: user ?? ctx.user,
            svc,
          });
          try {
            if (!user) throw fail('PERMISSION', '原操作员已停用，备份已停止');
            svc.permissions.require('backup.create');
            await doBackup(id, abort.signal);
            if (kind === 'automatic') {
              let note: string;
              try {
                const removed = await pruneAutomatic(config.keep);
                note = `保留最新 ${config.keep} 份有效自动备份；已轮替 ${removed.length} 份`;
              } catch {
                note = '新备份成功；轮替失败，旧备份保留，请检查目录权限';
              }
              await db
                .updateTable('backup_item')
                .set({ retention_note: note })
                .where('id', '=', id)
                .execute();
              try {
                await svc.log.write({
                  action: 'backup.retention',
                  summary: note,
                  targetType: 'backup_item',
                  targetId: id,
                });
              } catch {
                await db
                  .updateTable('backup_item')
                  .set({ retention_note: `${note}；操作日志保存失败` })
                  .where('id', '=', id)
                  .execute();
              }
            }
          } catch (e) {
            const err = fileError(e);
            terminal = {
              status: abort.signal.aborted ? 'cancelled' : 'failed',
              reason: err.message,
            };
            await writeFailure(svc, id, terminal);
          }
        })
        .catch((error: unknown) => {
          state(ctx.app).failures.set(id, {
            bookId: ctx.book.id,
            error,
            user: originalUser,
            terminal: terminal ?? {
              status: abort.signal.aborted ? 'cancelled' : 'failed',
              reason: fileError(error).message,
            },
          });
          throw error;
        })
        .finally(() => {
          state(ctx.app).jobs.delete(id);
          state(ctx.app).busy.delete(ctx.book.id);
        });
      state(ctx.app).jobs.set(id, { bookId: ctx.book.id, abort, promise, progress: 0 });
      // 保留原 Promise 的拒绝供 waitForJobs / 同步保护备份观察，只处理 detached rejection。
      void promise.catch(() => {});
      if (synchronous) await promise;
      return load(id);
    } catch (e) {
      state(ctx.app).busy.delete(ctx.book.id);
      throw fileError(e);
    }
  };
  const create = (
    input: { requestId: string; name: string },
    kind: 'manual' | 'automatic' | 'pre-restore' = 'manual',
    synchronous = false,
  ) => {
    const data = CreateSchema.parse(input);
    const key = `${ctx.book.id}/${data.requestId}`;
    const pending = state(ctx.app).creating.get(key);
    if (pending) return pending;
    const task = startBackup(data, kind, synchronous).finally(() =>
      state(ctx.app).creating.delete(key),
    );
    state(ctx.app).creating.set(key, task);
    return task;
  };
  const loadPlan = async (id: string) => {
    const plan = await db
      .selectFrom('backup_plan')
      .selectAll()
      .where('id', '=', id)
      .where('owner_id', '=', ctx.book.id)
      .where('user_id', '=', ctx.user.id)
      .executeTakeFirst();
    if (!plan) throw fail('PLAN', '恢复预览不存在或不属于当前用户');
    return plan;
  };
  const fingerprint = () => ctx.app.bookStore.revision(ctx.book.id);
  const confirmation = (p: Awaited<ReturnType<typeof loadPlan>>) =>
    p.purpose === 'copy' ? `恢复副本 ${p.target_name}` : `覆盖 ${p.target_name}`;
  const self = {
    settings,
    async overview() {
      const config = await settings();
      const last = await db
        .selectFrom('backup_item')
        .selectAll()
        .where('owner_id', '=', ctx.book.id)
        .where('kind', '=', 'automatic')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      const lastSuccess = await db
        .selectFrom('backup_item')
        .selectAll()
        .where('owner_id', '=', ctx.book.id)
        .where('kind', '=', 'automatic')
        .where('status', '=', 'valid')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      const lastFailure = await db
        .selectFrom('backup_item')
        .selectAll()
        .where('owner_id', '=', ctx.book.id)
        .where('kind', '=', 'automatic')
        .where('status', 'in', ['failed', 'cancelled', 'invalid'])
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      return {
        book: await ctx.svc.book.info(),
        period: await ctx.svc.periods.current(),
        estimatedBytes:
          (ctx.book.raw.pragma('page_count', { simple: true }) as number) *
          (ctx.book.raw.pragma('page_size', { simple: true }) as number),
        config,
        last,
        lastSuccess,
        lastFailure,
        nextAt: null,
        runtimeStatus: config.enabled
          ? '已启用自动备份：本地服务按启动、定时和正常退出设置执行'
          : '自动备份已关闭，请按需手动备份',
        transferLimit: TRANSFER_LIMIT,
        managedRoot: `backups/${ctx.book.id}`,
      };
    },
    async list() {
      const rows = await db
        .selectFrom('backup_item')
        .selectAll()
        .where('owner_id', '=', ctx.book.id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      for (const row of rows)
        if (
          row.status === 'running' &&
          !state(ctx.app).jobs.has(row.id) &&
          !state(ctx.app).creating.has(`${ctx.book.id}/${row.request_id}`)
        ) {
          row.status = 'failed';
          row.reason = '服务中断，备份未完成；请重新创建';
          await db
            .updateTable('backup_item')
            .set({ status: row.status, reason: row.reason })
            .where('id', '=', row.id)
            .execute();
        }
      return rows.map((r) => ({
        ...r,
        progress: state(ctx.app).jobs.get(r.id)?.progress ?? r.progress,
        metadata: r.metadata ? MetadataSchema.parse(JSON.parse(r.metadata)) : null,
      }));
    },
    create,
    async cancel(id: string) {
      await load(id);
      state(ctx.app).jobs.get(id)?.abort.abort();
    },
    async verify(id: string) {
      const checked = await verify(id);
      await rm(checked.snapshot);
      await ctx.svc.log.write({
        action: 'backup.verify',
        summary: '备份只读校验通过',
        targetId: id,
      });
      return checked.metadata;
    },
    async download(id: string) {
      const row = await load(id);
      if (row.bytes > TRANSFER_LIMIT)
        throw fail(
          'TRANSFER_SIZE',
          '备份超过浏览器传输上限 32 MiB',
          '需要共享层提供受管流式上传下载接口；请保留本机受管包',
        );
      const checked = await verify(id, true);
      await rm(checked.snapshot);
      return {
        name: `${row.name}-${row.id}.caiwubak`,
        base64: checked.content!.toString('base64'),
      };
    },
    async upload(input: { name: string; base64: string }) {
      const data = UploadSchema.parse(input);
      const buffer = decodeUploadBase64(data.base64);
      return exclusive(ctx, async () => {
        const dir = await directory(ctx.app.dataDir, ctx.book.id, '上传');
        await probeDirectory(dir, buffer.length * 3);
        const id = randomUUID();
        const tmp = path.join(dir, `.${id}.partial`);
        let checking: string | undefined;
        try {
          const h = await open(tmp, 'wx', 0o600);
          try {
            await h.writeFile(buffer);
            await h.sync();
          } finally {
            await h.close();
          }
          const checked = await validatePackage(tmp, ctx.app);
          checking = checked.snapshot;
          const existing = await db
            .selectFrom('backup_item')
            .selectAll()
            .where('owner_id', '=', ctx.book.id)
            .where('digest', '=', checked.digest)
            .where('status', '=', 'valid')
            .executeTakeFirst();
          if (existing) return existing;
          await link(tmp, packagePath(dir, id));
          await rm(tmp);
          await db
            .insertInto('backup_item')
            .values({
              id,
              owner_id: ctx.book.id,
              request_id: id,
              name: data.name,
              directory: '上传',
              kind: 'imported',
              status: 'valid',
              reason: '',
              metadata: JSON.stringify(checked.metadata),
              bytes: checked.bytes,
              digest: checked.digest,
              created_at: now(),
              progress: 100,
              retention_note: '',
            })
            .execute();
          await ctx.svc.log.write({
            action: 'backup.upload',
            summary: '可携带包已校验并导入目录',
            targetId: id,
          });
          return load(id);
        } catch (e) {
          throw fileError(e);
        } finally {
          await rm(tmp, { force: true });
          if (checking) await rm(checking, { force: true });
        }
      });
    },
    async saveSettings(raw: BackupSettings) {
      const config = SettingsSchema.parse(raw);
      try {
        await probeDirectory(await directory(ctx.app.dataDir, ctx.book.id, config.directory));
      } catch (e) {
        throw fileError(e);
      }
      await ctx.svc.settings.set('automatic', config);
      await ctx.svc.log.write({
        action: 'backup.settings',
        summary: '更新自动备份配置',
      });
      return config;
    },
    async prune(input: { id: string; text: string; password: string }) {
      const { id, text, password } = DeleteSchema.parse(input);
      const user = await authenticateUser(ctx.book.db, ctx.user.code, password);
      if (!user || user.id !== ctx.user.id)
        throw fail('CREDENTIAL', '当前操作员密码不正确或账号已停用');
      if (!user.isAdmin && !user.permissions.has('backup.prune'))
        throw fail('PERMISSION', '删除备份权限已经变更，请重新登录');
      return exclusive(ctx, async () => {
        const row = await load(id);
        if (text !== `删除备份 ${row.id}`)
          throw fail('CONFIRM', '删除确认文字不匹配，请核对备份 ID');
        if (row.kind === 'pre-restore') throw fail('PROTECTED', '恢复前保护备份不能在本页面删除');
        if (state(ctx.app).jobs.has(id)) throw fail('BUSY', '请先取消并等待备份结束');
        const file = await fileOf(row);
        if ((await hashFile(file)) !== row.digest)
          throw fail(
            'CHANGED',
            '备份文件已被替换，不能把未知文件作为受管备份删除',
            '请核对文件来源；本操作未删除文件',
          );
        await rm(file);
        await db
          .updateTable('backup_item')
          .set({ status: 'pruned', reason: '用户明确删除' })
          .where('id', '=', id)
          .execute();
        await ctx.svc.log.write({ action: 'backup.prune', summary: '删除受管备份', targetId: id });
      });
    },
    async preview(id: string, purpose: 'copy' | 'overwrite', name?: string) {
      return exclusive(ctx, async () => {
        admin();
        ctx.svc.permissions.require('backup.verify');
        const checked = await verify(id);
        await rm(checked.snapshot);
        if (purpose === 'copy') {
          const previous = await db
            .selectFrom('backup_plan')
            .selectAll()
            .where('owner_id', '=', ctx.book.id)
            .where('digest', '=', checked.digest)
            .where('purpose', '=', 'copy')
            .where('status', '!=', 'cancelled')
            .executeTakeFirst();
          if (previous) {
            if (previous.user_id !== ctx.user.id)
              throw fail('DUPLICATE', '这份备份已有另一位管理员的引入计划');
            if (previous.status === 'ready' && previous.expires_at <= now()) {
              previous.expires_at = new Date(ctx.app.now().getTime() + 10 * 60_000).toISOString();
              await db
                .updateTable('backup_plan')
                .set({ expires_at: previous.expires_at })
                .where('id', '=', previous.id)
                .execute();
            }
            return {
              ...previous,
              confirmation: confirmation(previous),
              metadata: checked.metadata,
              targetBook: await ctx.svc.book.info(),
              targetPeriod: (await ctx.svc.periods.current())?.period ?? null,
            };
          }
        }
        const targetName =
          purpose === 'copy'
            ? NameSchema.parse(name ?? `${checked.metadata.book.name.slice(0, 50)}（恢复副本）`)
            : (await ctx.svc.book.info()).name;
        const plan = {
          id: randomUUID(),
          owner_id: ctx.book.id,
          user_id: ctx.user.id,
          backup_id: id,
          digest: checked.digest,
          target_id: purpose === 'copy' ? randomUUID() : ctx.book.id,
          target_name: targetName,
          purpose,
          expires_at: new Date(ctx.app.now().getTime() + 10 * 60_000).toISOString(),
          status: 'ready',
          fingerprint: '',
          protection_id: null,
          created_at: now(),
          reason: '',
        };
        await db.insertInto('backup_plan').values(plan).execute();
        if (purpose === 'overwrite')
          state(ctx.app).overwrites.set(plan.id, { revision: fingerprint() });
        return {
          ...plan,
          confirmation: confirmation(plan),
          metadata: checked.metadata,
          targetBook: await ctx.svc.book.info(),
          targetPeriod: (await ctx.svc.periods.current())?.period ?? null,
        };
      });
    },
    async cancelPlan(id: string) {
      return exclusive(ctx, async () => {
        const plan = await loadPlan(id);
        if (plan.status !== 'ready') throw fail('PLAN', '只能取消尚未开始的恢复');
        await db
          .updateTable('backup_plan')
          .set({ status: 'cancelled' })
          .where('id', '=', id)
          .execute();
        state(ctx.app).overwrites.delete(id);
      });
    },
    async prepareOverwrite(planId: string): Promise<Protection> {
      admin();
      ctx.svc.permissions.require('backup.create');
      ctx.svc.permissions.require('backup.verify');
      const key = `${ctx.book.id}/${ctx.user.id}/${planId}`;
      const pending = state(ctx.app).preparing.get(key);
      if (pending) return pending;
      const task = (async () => {
        const plan = await loadPlan(planId);
        if (plan.purpose !== 'overwrite' || plan.status !== 'ready' || plan.expires_at <= now())
          throw fail('PLAN', '覆盖预览已失效，请重新预览');
        const prepared = state(ctx.app).overwrites.get(plan.id);
        if (!prepared || prepared.revision !== fingerprint())
          throw fail('TARGET_CHANGED', '目标账套在预览后发生变化，请重新预览并备份');
        if (prepared.protection) {
          if (Date.parse(prepared.protection.expiresAt) <= Date.now())
            throw fail('EXPIRED', '覆盖确认已过期，请重新预览');
          return prepared.protection;
        }
        const protection = await create(
          { requestId: randomUUID(), name: '恢复前保护备份' },
          'pre-restore',
          true,
        );
        if (protection.status !== 'valid')
          throw fail('PROTECTION', '恢复前保护备份失败，已阻止覆盖', protection.reason);
        const checkedProtection = await verify(protection.id);
        await rm(checkedProtection.snapshot);
        await db
          .updateTable('backup_plan')
          .set({ protection_id: protection.id })
          .where('id', '=', plan.id)
          .execute();
        return exclusive(ctx, async () => {
          const checked = await verify(plan.backup_id);
          try {
            if (checked.digest !== plan.digest) throw fail('CHANGED', '备份在预览后发生变化');
            const bytes = await readFile(checked.snapshot);
            if (
              bytes.length !== checked.metadata.length ||
              createHash('sha256').update(bytes).digest('hex') !== checked.metadata.sha256
            )
              throw fail('CHANGED', '已校验快照在暂存前发生变化，覆盖未执行');
            const localRows = await db
              .selectFrom('backup_item')
              .selectAll()
              .where('owner_id', '=', ctx.book.id)
              .where('status', '=', 'valid')
              .execute();
            const localBackups: LocalBackup[] = [];
            for (const row of localRows)
              localBackups.push(await verifiedLocalBackup(ctx.app, ctx.book.id, row));
            if (
              !localBackups.some((row) => row.id === plan.backup_id) ||
              !localBackups.some((row) => row.id === protection.id)
            )
              throw fail('CATALOG', '恢复来源或保护备份登记已变化，请重新预览');
            const revision = fingerprint();
            const expiresAt = Math.min(Date.now() + 5 * 60_000, Date.parse(plan.expires_at));
            const replacementInput = {
              sourceBookId: checked.metadata.book.id,
              bookId: ctx.book.id,
              bytes,
              length: checked.metadata.length,
              sha256: checked.metadata.sha256,
              expectedRevision: revision,
              expiresAt,
            };
            const ticket = await ctx.app.bookStore.prepareReplacement(replacementInput);
            const result: Protection = {
              protectionId: protection.id,
              createdAt: protection.created_at,
              location: `backups/${ctx.book.id}/${protection.directory}/${protection.id}.caiwubak`,
              confirmation: confirmation(plan),
              available: true,
              expiresAt: new Date(expiresAt).toISOString(),
            };
            state(ctx.app).overwrites.set(plan.id, {
              revision,
              replacementId: ticket.replacementId,
              protection: result,
              localBackups: Object.freeze(localBackups),
            });
            return result;
          } finally {
            await rm(checked.snapshot, { force: true });
          }
        });
      })();
      state(ctx.app).preparing.set(key, task);
      try {
        return await task;
      } finally {
        state(ctx.app).preparing.delete(key);
      }
    },
    async restore(raw: { planId: string; text: string; password: string }) {
      const input = ConfirmSchema.parse(raw);
      admin();
      ctx.svc.permissions.require('backup.verify');
      const authenticated = await authenticateUser(ctx.book.db, ctx.user.code, input.password);
      if (!authenticated?.isAdmin || authenticated.id !== ctx.user.id)
        throw fail('CREDENTIAL', '管理员密码不正确或账号已停用');
      return exclusive(ctx, async () => {
        const plan = await loadPlan(input.planId);
        if (input.text !== confirmation(plan))
          throw fail('CONFIRM', '确认文字不匹配，请核对目标后输入指定文字');
        if (plan.status === 'done') {
          if (!ctx.app.bookStore.exists(plan.target_id))
            throw fail('COPY_MISSING', '之前恢复的新副本已被移除，请核对账套目录');
          return {
            bookId: plan.target_id,
            name: plan.target_name,
            relogin: true,
            purpose: 'copy' as const,
          };
        }
        if (plan.status !== 'ready' || plan.expires_at <= now())
          throw fail('EXPIRED', '确认已取消或过期，请重新预览');
        if (plan.purpose === 'overwrite') {
          if (!plan.protection_id) throw fail('PROTECTION', '尚未完成恢复前保护备份');
          ctx.svc.permissions.require('backup.create');
          const prepared = state(ctx.app).overwrites.get(plan.id);
          if (!prepared?.replacementId || !prepared.protection || !prepared.localBackups)
            throw fail('PROTECTION', '覆盖准备已失效，请重新预览并生成保护备份');
          if (Date.parse(prepared.protection.expiresAt) <= Date.now())
            throw fail('EXPIRED', '覆盖确认已过期，请重新预览');
          if (prepared.revision !== fingerprint())
            throw fail('TARGET_CHANGED', '目标账套在确认后发生变化，请重新预览并备份');
          const protection = await load(plan.protection_id);
          const checkedProtection = await verify(protection.id);
          await rm(checkedProtection.snapshot);
          const localBackups = prepared.localBackups;
          const runtime = ctx.app;
          const targetId = ctx.book.id;
          const actorId = ctx.user.id;
          const actorName = ctx.user.name;
          const sessionToken = ctx.session.token;
          const clock = runtime.now;
          // 升级维护后原请求 svc/连接已撤销，只能使用共享层给出的新服务和新连接。
          try {
            await runtime.lifecycle.maintainBook({
              token: sessionToken,
              bookId: targetId,
              permission: 'backup.restore',
              confirmation: {
                bookId: targetId,
                bookName: plan.target_name,
                password: input.password,
              },
              authorize: async (svc) => {
                svc.permissions.require('backup.restore');
                svc.permissions.require('backup.create');
                svc.permissions.require('backup.verify');
                const current = await svc.db
                  .withTables<BackupTables>()
                  .selectFrom('backup_plan')
                  .selectAll()
                  .where('id', '=', plan.id)
                  .executeTakeFirst();
                if (
                  !current ||
                  current.owner_id !== targetId ||
                  current.user_id !== actorId ||
                  current.purpose !== 'overwrite' ||
                  current.target_id !== targetId ||
                  current.target_name !== plan.target_name ||
                  current.backup_id !== plan.backup_id ||
                  current.status !== 'ready' ||
                  current.expires_at <= clock().toISOString() ||
                  current.digest !== plan.digest ||
                  current.protection_id !== protection.id
                )
                  throw fail('EXPIRED', '恢复计划已变化或过期，请重新预览');
                if (prepared.revision !== runtime.bookStore.revision(targetId))
                  throw fail('TARGET_CHANGED', '目标账套在确认后发生变化，请重新预览并备份');
              },
              plan: {
                kind: 'replace',
                replacementId: prepared.replacementId,
                validate: async (book, signal) => {
                  signal.throwIfAborted();
                  if (book.id !== targetId)
                    throw fail(
                      'TARGET_CHANGED',
                      '恢复后的账套身份与覆盖目标不符，正在回滚保护副本',
                    );
                  // 排空后再次校验冻结的本机文件；任一变化由共享维护流程回滚。
                  for (const row of localBackups) {
                    signal.throwIfAborted();
                    await verifiedLocalBackup(runtime, targetId, row);
                  }
                  // 丢弃源机器登记，只重建替换前已验证的目标本机目录（含来源及历史保护）。
                  await book.db.transaction().execute(async (tx) => {
                    await tx.withTables<BackupTables>().deleteFrom('backup_plan').execute();
                    await tx.withTables<BackupTables>().deleteFrom('backup_item').execute();
                    await tx
                      .withTables<BackupTables>()
                      .insertInto('backup_item')
                      .values(localBackups)
                      .execute();
                    await tx
                      .updateTable('book_info')
                      .set({ name: plan.target_name, updated_at: clock().toISOString() })
                      .where('id', '=', 1)
                      .execute();
                    await tx
                      .deleteFrom('book_setting')
                      .where((eb) =>
                        eb.or([
                          eb.and([eb('scope', '=', 'backup'), eb('key', '=', 'restorePlan')]),
                          eb.and([eb('scope', '=', 'core'), eb('key', '=', 'lastOpenedAt')]),
                        ]),
                      )
                      .execute();
                    await tx
                      .insertInto('operation_log')
                      .values({
                        at: clock().toISOString(),
                        user_id: null,
                        user_name: actorName,
                        module: 'backup',
                        action: 'backup.restore.overwrite',
                        summary: `从完整备份覆盖账套「${plan.target_name}」；恢复前保护备份 ${protection.id}；请重新登录`,
                        target_type: 'book',
                        target_id: targetId,
                        detail: null,
                      })
                      .execute();
                    signal.throwIfAborted();
                  });
                  if (
                    (book.raw.pragma('integrity_check') as { integrity_check: string }[])[0]
                      ?.integrity_check !== 'ok'
                  )
                    throw fail('INTEGRITY', '恢复后的账套校验失败，正在回滚保护副本');
                },
              },
            });
          } catch (error) {
            if (error instanceof BusinessError) throw error;
            throw fail(
              'RESTORE_FAILED',
              '覆盖恢复未完成，保护备份已保留',
              '请重新登录核对账套；如账套已隔离，请先修复存储，再由管理员恢复保护副本',
            );
          } finally {
            state(runtime).overwrites.delete(plan.id);
          }
          return {
            bookId: plan.target_id,
            name: plan.target_name,
            relogin: true,
            purpose: 'overwrite' as const,
          };
        }
        const checked = await verify(plan.backup_id);
        if (checked.digest !== plan.digest) {
          await rm(checked.snapshot);
          throw fail('CHANGED', '备份在预览后发生变化');
        }
        const booksDir = ctx.app.bookStore.booksDir;
        const target = ctx.app.bookStore.pathOf(plan.target_id);
        const tmp = path.join(booksDir, `.${randomUUID()}.backup-import`);
        let tmpOwned = false;
        let published = false;
        try {
          const dirStat = await lstat(booksDir);
          if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
            throw fail('PATH', '账套目录不能是符号链接');
          const existingStat = await lstat(target).then(
            (s) => s,
            (e: NodeJS.ErrnoException) => {
              if (e.code === 'ENOENT') return null;
              throw e;
            },
          );
          for (const suffix of ['-wal', '-shm', '-journal']) {
            const sidecar = await lstat(`${target}${suffix}`).then(
              () => true,
              (error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return false;
                throw error;
              },
            );
            if (sidecar) throw fail('COLLISION', '目标新 ID 已有数据库辅助文件，禁止发布或认领');
          }
          if (existingStat) {
            if (!existingStat.isFile() || existingStat.isSymbolicLink() || existingStat.nlink !== 1)
              throw fail('COLLISION', '目标新 ID 已被其他文件或符号链接占用，禁止覆盖');
            // 只对本计划已完成暂存的目标恢复登记，不能认领同名不相关文件。
            let existing: Database.Database | undefined;
            try {
              existing = new Database(target, { readonly: true, fileMustExist: true });
              const origin = existing
                .prepare('SELECT value FROM book_setting WHERE scope = ? AND key = ?')
                .get('backup', 'restorePlan') as { value: string } | undefined;
              if (origin?.value !== JSON.stringify(plan.id))
                throw fail('COLLISION', '目标新 ID 已有其他文件，禁止覆盖');
            } catch {
              throw fail(
                'COLLISION',
                '目标新 ID 已有无法确认归属的文件，禁止覆盖',
                '请核对目标账套；原文件保留',
              );
            } finally {
              existing?.close();
            }
            const restored = inspectSqlite(target, ctx.app);
            if (restored.book.id !== plan.target_id || restored.book.name !== plan.target_name)
              throw fail('COLLISION', '已发布副本的账套信息发生变化，不能自动认领');
            published = true;
          } else {
            await copyFile(checked.snapshot, tmp, constants.COPYFILE_EXCL);
            tmpOwned = true;
            const rawDb = new Database(tmp);
            try {
              rawDb.pragma('trusted_schema = OFF');
              rawDb.pragma('journal_mode = DELETE');
              rawDb.transaction(() => {
                rawDb
                  .prepare(
                    'UPDATE book_info SET book_id = ?, name = ?, updated_at = ? WHERE id = 1',
                  )
                  .run(plan.target_id, plan.target_name, now());
                rawDb.prepare('DELETE FROM backup_plan').run();
                rawDb.prepare('DELETE FROM backup_item').run();
                rawDb
                  .prepare(
                    "DELETE FROM book_setting WHERE (scope='backup' AND key='restorePlan') OR (scope='core' AND key='lastOpenedAt')",
                  )
                  .run();
                rawDb
                  .prepare('INSERT INTO book_setting(scope,key,value,updated_at) VALUES (?,?,?,?)')
                  .run('backup', 'restorePlan', JSON.stringify(plan.id), now());
                rawDb
                  .prepare(
                    'INSERT INTO operation_log(at,user_id,user_name,module,action,summary) VALUES (?,?,?,?,?,?)',
                  )
                  .run(
                    now(),
                    null,
                    '系统',
                    'backup',
                    'backup.restore.copy',
                    '从完整备份恢复为独立新账套；请重新登录',
                  );
              })();
              if (
                (rawDb.pragma('integrity_check') as { integrity_check: string }[])[0]
                  ?.integrity_check !== 'ok'
              )
                throw fail('INTEGRITY', '新副本校验失败，未发布');
            } finally {
              rawDb.close();
            }
            inspectSqlite(tmp, ctx.app);
            const h = await open(tmp, 'r+');
            try {
              await h.sync();
            } finally {
              await h.close();
            }
            // 同目录 hard-link 原子发布，EEXIST 时绝不覆盖；临时文件随后删除。
            await link(tmp, target);
            published = true;
            await rm(tmp);
          }
          await db
            .updateTable('backup_plan')
            .set({ status: 'done', reason: '' })
            .where('id', '=', plan.id)
            .execute();
          await ctx.svc.log.write({
            action: 'backup.restore.copy',
            summary: `恢复新副本「${plan.target_name}」，原账套保留`,
            targetId: plan.target_id,
          });
          ctx.app.sessions.deleteForBook(ctx.book.id);
          ctx.app.sessions.deleteForBook(plan.target_id);
          return {
            bookId: plan.target_id,
            name: plan.target_name,
            relogin: true,
            purpose: 'copy' as const,
          };
        } catch (e) {
          // 发布后登记失败保留带 plan 标识的完整副本，重试只认领本计划文件。
          await db
            .updateTable('backup_plan')
            .set({
              reason: published
                ? '新副本已发布，登记未完成；可重新登录后重试同一计划'
                : '引入失败；原账套未改变',
            })
            .where('id', '=', plan.id)
            .execute();
          throw fileError(e);
        } finally {
          await rm(checked.snapshot, { force: true });
          if (tmpOwned) await rm(tmp, { force: true });
        }
      });
    },
  };
  return self;
}
export type BackupService = ReturnType<typeof backupService>;
export type BackupListItem = Awaited<ReturnType<BackupService['list']>>[number];
