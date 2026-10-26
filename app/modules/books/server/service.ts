import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase, type RawDatabase } from '@caiwu/db';
import { BusinessError, type BookInfo } from '@caiwu/core';
import {
  authenticateUser,
  createCoreServices,
  type CoreDB,
  type CoreServices,
} from '@caiwu/core/server';
import type { AppRuntime } from '@caiwu/server-kit';
import { CopySchema, DeleteSchema, NamesSchema, TargetSchema } from '../shared';
import type { z } from 'zod';

type Actor = { bookId: string; token: string; userId: number };
type Target = z.input<typeof TargetSchema>;
type DeleteResult = { ok: true; backupId: string; archiveId: string };
type Ticket = {
  actor: string;
  targetId: string;
  userCode: string;
  name: string;
  expires: number;
  backupId: string;
  result?: DeleteResult;
};
type State = { locks: Map<string, Promise<unknown>>; tickets: Map<string, Ticket> };
const states = new WeakMap<AppRuntime, State>();
function state(app: AppRuntime) {
  let s = states.get(app);
  if (!s) {
    s = { locks: new Map(), tickets: new Map() };
    states.set(app, s);
  }
  return s;
}
const identity = (a: Actor) => `${a.bookId}/${a.userId}/${a.token}`;
const problem = (
  code: string,
  message: string,
  hint = '请刷新账套列表后重试；原账套和已完成的备份会保留',
) => new BusinessError({ code, message, hint });

/** 故障注入仅供真实 SQLite 测试；路由不接受这些参数。 */
export type FileHooks = {
  snapshot?: (raw: RawDatabase, file: string) => Promise<void>;
  beforePublish?: () => void;
  afterArchive?: () => void;
};

function assertSnapshot(file: string, id: string) {
  const raw = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (raw.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('SQLite完整性检查失败');
    if ((raw.pragma('foreign_key_check') as unknown[]).length)
      throw new Error('SQLite外键检查失败');
    const row = raw.prepare('SELECT book_id FROM book_info WHERE id=1').get() as
      { book_id: string } | undefined;
    if (row?.book_id !== id) throw new Error('账套文件身份不匹配');
  } finally {
    raw.close();
  }
}

export function booksService(
  app: AppRuntime,
  svc: CoreServices,
  actor: Actor,
  hooks: FileHooks = {},
) {
  const s = state(app);
  const store = app.bookStore;
  const serialize = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const previous = s.locks.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    s.locks.set(id, task);
    try {
      return await task;
    } finally {
      if (s.locks.get(id) === task) s.locks.delete(id);
    }
  };
  const target = async (raw: Target, permission: string) => {
    const input = TargetSchema.parse(raw);
    if (!store.exists(input.targetId))
      throw problem(
        'BOOKS_TARGET_MISSING',
        '目标账套文件已移走或不存在',
        '刷新列表；如文件损坏，请先使用备份恢复',
      );
    try {
      const book = store.open(input.targetId);
      const user = await authenticateUser(book.db, input.userCode, input.password);
      if (!user)
        throw problem(
          'BOOKS_TARGET_AUTH',
          '目标账套用户代码或当前密码错误',
          '请输入目标账套的有效用户和当前密码',
        );
      const targetSvc = createCoreServices({ ...svc.ctx, db: book.db, user, moduleId: 'books' });
      targetSvc.permissions.require(permission);
      const info = await targetSvc.book.info();
      if (info.id !== input.targetId)
        throw problem('BOOKS_ID_MISMATCH', '文件身份与目标账套编号不一致');
      return { book, targetSvc, info };
    } catch (e) {
      if (e instanceof BusinessError) throw e;
      throw problem(
        'BOOKS_TARGET_DAMAGED',
        '目标账套无法打开或已损坏',
        '请保留原文件并使用有效备份恢复',
      );
    }
  };
  const snapshot = async (raw: RawDatabase, file: string, id: string) => {
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await (
        hooks.snapshot ??
        (async (db, dest) => {
          await db.backup(dest);
        })
      )(raw, tmp);
      assertSnapshot(tmp, id);
      // 同卷硬链接为原子、拒绝覆盖的发布。主库/WAL从未直接复制。
      linkSync(tmp, file);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(tmp + suffix, { force: true });
    }
  };
  const assertOther = (targetId: string) => {
    if (targetId === actor.bookId)
      throw problem(
        'BOOKS_CURRENT_IN_USE',
        '不能删除当前正在使用的账套',
        '请先切换并登录另一个账套，再从账套管理删除此账套',
      );
  };

  return {
    async info() {
      return svc.book.info();
    },
    async update(raw: z.input<typeof NamesSchema>) {
      const input = NamesSchema.parse(raw);
      try {
        return await svc.tx(async (tsvc) => {
          await tsvc.db
            .updateTable('book_info')
            .set({ name: input.name, org_name: input.orgName, updated_at: app.now().toISOString() })
            .where('id', '=', 1)
            .execute();
          await tsvc.log.write({
            action: 'books.edit',
            summary: `修改账套名称及单位：${input.name}`,
            detail: input,
          });
          return tsvc.book.info();
        });
      } catch (e) {
        if (e instanceof BusinessError) throw e;
        throw problem(
          'BOOKS_SAVE_FAILED',
          '账套信息保存失败，名称和单位的改动已回滚',
          '请检查数据目录权限与空间后重新保存',
        );
      }
    },
    /** 登录后诊断，公共入口仍只使用core的公共读取。 */
    async diagnostics() {
      const listed = new Set((await store.list()).map((b) => b.id));
      return readdirSync(store.booksDir)
        .filter((name) => /^[0-9a-f-]{36}\.caiwu$/.test(name) && !listed.has(name.slice(0, -6)))
        .map((name) => ({
          id: name.slice(0, -6),
          message: '账套文件无法读取，可能已损坏；请保留原文件并使用备份恢复',
        }));
    },
    async copy(raw: z.input<typeof CopySchema>): Promise<BookInfo> {
      const input = CopySchema.parse(raw);
      return serialize(input.targetId, async () => {
        const { book, info, targetSvc } = await target(input, 'books.copy');
        // 收据随复制品存储；服务重启、响应丢失重试也不再创建第二份。
        const receipt = JSON.stringify({
          sourceId: input.targetId,
          requestId: input.requestId,
          actorBookId: actor.bookId,
          actorUserId: actor.userId,
          name: input.name,
        });
        for (const b of await store.list()) {
          const db = new Database(store.pathOf(b.id), { readonly: true, fileMustExist: true });
          try {
            const row = db
              .prepare("SELECT value FROM book_setting WHERE scope='books' AND key='copyReceipt'")
              .get() as { value: string } | undefined;
            if (row?.value === receipt) return b;
            if (row) {
              const prior = JSON.parse(row.value) as {
                requestId: string;
                actorBookId: string;
                actorUserId: number;
              };
              if (
                prior.requestId === input.requestId &&
                prior.actorBookId === actor.bookId &&
                prior.actorUserId === actor.userId
              )
                throw problem(
                  'BOOKS_COPY_CONFLICT',
                  '此复制请求已使用其它名称或来源完成',
                  '请刷新列表查看复制品；另建复制品时重新打开复制对话框',
                );
            }
          } finally {
            db.close();
          }
        }
        const id = randomUUID();
        const tmp = path.join(store.booksDir, `.${id}.copying`);
        let published = false;
        try {
          await snapshot(book.raw, tmp, info.id);
          const copy = openDatabase<CoreDB>(tmp);
          try {
            const copySvc = createCoreServices({ ...targetSvc.ctx, db: copy.db });
            await copySvc.tx(async (tsvc) => {
              await tsvc.db
                .updateTable('book_info')
                .set({
                  book_id: id,
                  name: input.name,
                  created_at: app.now().toISOString(),
                  updated_at: app.now().toISOString(),
                })
                .where('id', '=', 1)
                .execute();
              await tsvc.db
                .deleteFrom('book_setting')
                .where('scope', '=', 'core')
                .where('key', '=', 'lastOpenedAt')
                .execute();
              await tsvc.settings.set('copyReceipt', JSON.parse(receipt));
              await tsvc.log.write({
                action: 'books.copy',
                summary: `从「${info.name}」复制为「${input.name}」`,
                detail: { sourceId: info.id, requestId: input.requestId },
              });
            });
          } finally {
            await copy.close();
          }
          assertSnapshot(tmp, id);
          hooks.beforePublish?.();
          linkSync(tmp, store.pathOf(id));
          published = true;
          return { ...info, id, name: input.name, createdAt: app.now().toISOString() };
        } catch (e) {
          if (e instanceof BusinessError) throw e;
          throw problem('BOOKS_COPY_FAILED', '复制失败，未覆盖源账套或已有账套');
        } finally {
          for (const suffix of ['', '-wal', '-shm']) rmSync(tmp + suffix, { force: true });
          // published只表示已完成原子发布，之后不再执行可失败的写操作。
          if (!published) await store.close(id);
        }
      });
    },
    async prepareDelete(raw: Target) {
      const input = TargetSchema.parse(raw);
      assertOther(input.targetId);
      return serialize(input.targetId, async () => {
        const { book, info } = await target(input, 'books.delete');
        const ticket = randomUUID();
        const backupId = `${input.targetId}-${ticket}.caiwu`;
        const dir = path.join(app.dataDir, 'books-backups');
        try {
          mkdirSync(dir, { recursive: true });
          await snapshot(book.raw, path.join(dir, backupId), input.targetId);
        } catch {
          throw problem(
            'BOOKS_BACKUP_FAILED',
            '自动备份失败，账套未删除',
            '检查数据目录空间及写入权限后重试',
          );
        }
        for (const [key, t] of s.tickets) if (t.expires < Date.now()) s.tickets.delete(key);
        s.tickets.set(ticket, {
          actor: identity(actor),
          targetId: input.targetId,
          userCode: input.userCode,
          name: info.name,
          expires: Date.now() + 10 * 60_000,
          backupId,
        });
        return { ticket, backupId, book: info };
      });
    },
    async cancelDelete(ticket: string) {
      const t = s.tickets.get(ticket);
      if (t?.actor === identity(actor) && !t.result) s.tickets.delete(ticket);
      return { ok: true };
    },
    async remove(raw: z.input<typeof DeleteSchema>): Promise<DeleteResult> {
      const input = DeleteSchema.parse(raw);
      assertOther(input.targetId);
      return serialize(input.targetId, async () => {
        const t = s.tickets.get(input.ticket);
        if (
          !t ||
          t.actor !== identity(actor) ||
          t.targetId !== input.targetId ||
          t.userCode !== input.userCode ||
          t.expires < Date.now()
        )
          throw problem('BOOKS_CONFIRM_EXPIRED', '删除确认已失效', '请重新验证目标账套身份并备份');
        if (input.confirmName !== t.name)
          throw problem(
            'BOOKS_CONFIRM_NAME',
            '输入的账套名称不一致，尚未删除',
            '请逐字输入确认页显示的目标账套名称',
          );
        if (t.result) return t.result;
        const { book, info } = await target(input, 'books.delete');
        if (info.name !== t.name)
          throw problem(
            'BOOKS_TARGET_CHANGED',
            '目标名称已变更，尚未删除',
            '请重新验证并备份后再确认',
          );
        const backupDir = path.join(app.dataDir, 'books-backups');
        const finalBackup = `${input.targetId}-${randomUUID()}.caiwu`;
        try {
          await snapshot(book.raw, path.join(backupDir, finalBackup), input.targetId);
        } catch {
          throw problem('BOOKS_BACKUP_FAILED', '最终备份失败，账套未删除');
        }
        const trashDir = path.join(app.dataDir, 'books-trash');
        try {
          mkdirSync(trashDir, { recursive: true });
        } catch {
          throw problem(
            'BOOKS_ARCHIVE_FAILED',
            '恢复目录不可写，账套未删除',
            '检查数据目录权限与空间后重试；自动备份已保留',
          );
        }
        const archiveId = `${input.targetId}-${input.ticket}.caiwu`;
        const archive = path.join(trashDir, archiveId);
        const active = store.pathOf(input.targetId);
        if (existsSync(archive))
          throw problem(
            'BOOKS_ARCHIVE_EXISTS',
            '恢复目录中已有同名文件，尚未移动账套',
            '请保留文件，重新发起删除',
          );
        let moved = false;
        try {
          if (book.raw.inTransaction)
            throw problem(
              'BOOKS_TARGET_BUSY',
              '目标账套正在处理业务，尚未删除',
              '请等待目标账套的操作完成后重试',
            );
          await store.close(input.targetId);
          // close完成后的同步重命名不跨越await，防止本进程重新打开窗口。
          renameSync(active, archive);
          moved = true;
          hooks.afterArchive?.();
          await svc.tx(async (tsvc) => {
            await tsvc.log.write({
              action: 'books.delete',
              summary: `账套「${info.name}」移入恢复目录`,
              detail: { targetId: input.targetId, backupId: finalBackup, archiveId },
            });
          });
          app.sessions.deleteForBook(input.targetId);
          t.result = { ok: true, backupId: finalBackup, archiveId };
          return t.result;
        } catch {
          if (moved) {
            try {
              renameSync(archive, active);
            } catch {
              throw problem(
                'BOOKS_RECOVERY_REQUIRED',
                '账套移动后回退失败，尚未确认删除成功',
                `请保留 books-trash/${archiveId} 和 books-backups/${finalBackup}，联系管理员恢复；不要新建同编号文件`,
              );
            }
          }
          throw problem(
            'BOOKS_DELETE_FAILED',
            '删除未完成，账套已保留或移回活动目录',
            '请刷新列表后重试，自动备份仍保留',
          );
        }
      });
    },
  };
}
